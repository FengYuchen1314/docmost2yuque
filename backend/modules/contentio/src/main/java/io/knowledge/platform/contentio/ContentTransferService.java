package io.knowledge.platform.contentio;

import io.knowledge.platform.analytics.AnalyticsEventCommand;
import io.knowledge.platform.analytics.AnalyticsRecorder;
import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationDeniedException;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.page.ContentCardExportService;
import io.knowledge.platform.page.ContentType;
import io.knowledge.platform.page.CreatePageCommand;
import io.knowledge.platform.page.PageService;
import java.awt.Color;
import java.awt.AlphaComposite;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.jsoup.Jsoup;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

@Service
public class ContentTransferService {
    private static final int MAX_UPLOAD=50*1024*1024;
    private static final int MAX_ZIP_ENTRIES=1000;
    private static final long MAX_UNCOMPRESSED=100L*1024*1024;
    private final ContentTransferRepository repository; private final AuthorizationService authorization;
    private final PageService pages; private final AnalyticsRecorder analytics; private final AuditService audit;
    private final ObjectMapper mapper; private final ContentCardExportService cardExports; private final StructuredExportService structuredExports; private final Clock clock;
    public ContentTransferService(ContentTransferRepository repository,AuthorizationService authorization,PageService pages,AnalyticsRecorder analytics,AuditService audit,ObjectMapper mapper,ContentCardExportService cardExports,StructuredExportService structuredExports,Clock clock){this.repository=repository;this.authorization=authorization;this.pages=pages;this.analytics=analytics;this.audit=audit;this.mapper=mapper;this.cardExports=cardExports;this.structuredExports=structuredExports;this.clock=clock;}

    @Transactional
    public TransferTaskView importFile(UUID actor,UUID knowledgeBaseId,String requestedFormat,String filename,byte[] bytes){
        var access=authorization.require(actor,ResourceType.KNOWLEDGE_BASE,knowledgeBaseId,Capability.EDIT);
        String format=format(requestedFormat,filename,Set.of("MARKDOWN","HTML","TXT","ZIP","DOCX","XLSX","NOTION","CONFLUENCE")); validateUpload(format,filename,bytes);
        UUID task=Ids.next();OffsetDateTime now=OffsetDateTime.now(clock);repository.insert(task,access.workspaceId(),"IMPORT",format,"KNOWLEDGE_BASE",knowledgeBaseId,safeFilename(filename),actor,mapper.createObjectNode(),now);repository.payload(task,bytes,now);
        return repository.find(task);
    }

    @Transactional
    public TransferTaskView exportPage(UUID actor,UUID pageId,String requestedFormat,boolean published){
        var access=authorization.require(actor,ResourceType.PAGE,pageId,Capability.EXPORT);var page=repository.page(pageId,published);if(page==null)throw new ResourceNotFoundException();String format=format(requestedFormat,null,exportFormats(page.contentType()));
        UUID task=Ids.next();OffsetDateTime now=OffsetDateTime.now(clock);ObjectNode report=mapper.createObjectNode().put("published",published).put("contentType",page.contentType());repository.insert(task,access.workspaceId(),"EXPORT",format,"PAGE",pageId,null,actor,report,now);return repository.find(task);
    }

    @Transactional
    public TransferTaskView exportKnowledgeBase(UUID actor,UUID knowledgeBaseId){
        var access=authorization.require(actor,ResourceType.KNOWLEDGE_BASE,knowledgeBaseId,Capability.EXPORT);UUID task=Ids.next();OffsetDateTime now=OffsetDateTime.now(clock);repository.insert(task,access.workspaceId(),"EXPORT","ZIP","KNOWLEDGE_BASE",knowledgeBaseId,null,actor,mapper.createObjectNode(),now);return repository.find(task);
    }

    @Transactional public boolean claim(UUID taskId){TransferTaskView task=repository.find(taskId);if(task!=null&&"PENDING".equals(task.status())&&task.cancelRequested()){repository.cancelPending(taskId,cancelledReport(task),OffsetDateTime.now(clock));return false;}return repository.claim(taskId,OffsetDateTime.now(clock));}
    @Transactional(readOnly=true) public List<UUID> pending(int limit){return repository.pending(Math.max(1,Math.min(limit,50)));}
    @Transactional public void execute(UUID taskId){TransferTaskView task=repository.find(taskId);if(task==null)throw new ResourceNotFoundException();if(!"RUNNING".equals(task.status()))return;ensureNotCancelled(taskId);if("IMPORT".equals(task.taskType()))executeImport(task);else if("PAGE".equals(task.resourceType()))executePageExport(task);else executeKnowledgeBaseExport(task);}
    @Transactional public void fail(UUID taskId,RuntimeException exception){TransferTaskView task=repository.find(taskId);if(task==null||Set.of("SUCCEEDED","FAILED","CANCELLED").contains(task.status()))return;OffsetDateTime now=OffsetDateTime.now(clock);if(exception instanceof ContentTransferCancellationException||repository.cancellationRequested(taskId)){repository.cancel(taskId,cancelledReport(task),now);return;}ObjectNode report=mapper.createObjectNode();report.put("importedCount",0);report.put("failedCount",1);report.put("error",safeError(exception));if(!repository.failed(taskId,report,now))repository.cancel(taskId,cancelledReport(task),now);}

    @Transactional
    public TransferTaskView cancel(UUID actor, UUID taskId) {
        TransferTaskView task = repository.find(taskId);
        if (task == null) throw new ResourceNotFoundException();
        if (!actor.equals(task.requestedBy())) throw new AuthorizationDeniedException();
        if ("CANCELLED".equals(task.status())) return task;
        if (Set.of("SUCCEEDED", "FAILED").contains(task.status())) {
            throw new DomainConflictException(
                    "CONTENT_TRANSFER_NOT_CANCELLABLE",
                    "A completed content transfer cannot be cancelled");
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        boolean requested = repository.requestCancellation(taskId, actor, now);
        if ("PENDING".equals(task.status())) {
            repository.cancelPending(taskId, cancelledReport(task), now);
        }
        if (requested) {
            audit.success(
                    task.workspaceId(), actor, "content.transfer.cancel", task.resourceType(), task.resourceId());
        }
        TransferTaskView current = repository.find(taskId);
        if (current != null && Set.of("SUCCEEDED", "FAILED").contains(current.status())) {
            repository.deleteCancellation(taskId);
            current = repository.find(taskId);
        }
        return current;
    }

    private void executeImport(TransferTaskView task){var access=authorization.require(task.requestedBy(),ResourceType.KNOWLEDGE_BASE,task.resourceId(),Capability.EDIT);byte[] bytes=repository.payload(task.id());if(bytes==null)throw new IllegalStateException("Import payload is missing");List<ImportDocument> documents=parse(task.sourceFormat(),task.originalFilename(),bytes);ensureNotCancelled(task.id());repository.progress(task.id(),25);ArrayNode resources=mapper.createArrayNode();int index=0;for(ImportDocument document:documents){ensureNotCancelled(task.id());String path=slug(document.title())+"-"+Ids.next().toString().replace("-","");var page=pages.create(task.requestedBy(),new CreatePageCommand(task.resourceId(),document.title(),path,document.type(),null,null,"INHERIT","INHERIT",mapper.createObjectNode(),document.content()));resources.addObject().put("pageId",page.id().toString()).put("title",page.title()).put("source",document.source());index++;repository.progress(task.id(),25+(int)(65.0*index/Math.max(1,documents.size())));}ensureNotCancelled(task.id());ObjectNode report=mapper.createObjectNode();report.put("importedCount",index);report.put("failedCount",0);report.set("resources",resources);if(!repository.success(task.id(),null,null,null,report,OffsetDateTime.now(clock)))throw new ContentTransferCancellationException();audit.success(access.workspaceId(),task.requestedBy(),"content.import","KNOWLEDGE_BASE",task.resourceId());}
    private void executePageExport(TransferTaskView task){var access=authorization.require(task.requestedBy(),ResourceType.PAGE,task.resourceId(),Capability.EXPORT);boolean published=task.report().path("published").asBoolean(false);var page=repository.page(task.resourceId(),published);if(page==null)throw new ResourceNotFoundException();Watermark watermark=watermark(page.watermarkConfig(),repository.userEmail(task.requestedBy()));repository.progress(task.id(),35);ensureNotCancelled(task.id());TransferArtifact generated=generate(page,task.sourceFormat(),watermark);ensureNotCancelled(task.id());ObjectNode report=mapper.createObjectNode();report.put("scope",published?"PUBLISHED":"DRAFT");report.put("contentType",page.contentType());report.put("bytes",generated.bytes().length);report.put("watermarkApplied",watermark.enabled());if(!repository.success(task.id(),generated.filename(),generated.mediaType(),generated.bytes(),report,OffsetDateTime.now(clock)))throw new ContentTransferCancellationException();analytics.record(new AnalyticsEventCommand(access.workspaceId(),task.requestedBy(),null,"PAGE",task.resourceId(),page.knowledgeBaseId(),"EXPORT",null,mapper.createObjectNode().put("format",task.sourceFormat()).put("contentType",page.contentType())));audit.success(access.workspaceId(),task.requestedBy(),"content.export","PAGE",task.resourceId());}
    private void executeKnowledgeBaseExport(TransferTaskView task){var access=authorization.require(task.requestedBy(),ResourceType.KNOWLEDGE_BASE,task.resourceId(),Capability.EXPORT);List<ContentTransferRepository.PageSnapshot> snapshots=repository.knowledgeBasePages(task.resourceId());String email=repository.userEmail(task.requestedBy());repository.progress(task.id(),35);ensureNotCancelled(task.id());byte[] bytes=knowledgeBaseZip(task.resourceId(),snapshots,email);ensureNotCancelled(task.id());ObjectNode report=mapper.createObjectNode();report.put("pageCount",snapshots.size());report.put("bytes",bytes.length);report.put("watermarkApplied",snapshots.stream().anyMatch(page->watermark(page.watermarkConfig(),email).enabled()));if(!repository.success(task.id(),"knowledge-base-"+task.resourceId()+".zip","application/zip",bytes,report,OffsetDateTime.now(clock)))throw new ContentTransferCancellationException();audit.success(access.workspaceId(),task.requestedBy(),"content.export","KNOWLEDGE_BASE",task.resourceId());}

    @Transactional(readOnly=true) public TransferTaskView get(UUID actor,UUID id){TransferTaskView value=repository.find(id);if(value==null)throw new ResourceNotFoundException();if(!actor.equals(value.requestedBy()))throw new AuthorizationDeniedException();return value;}
    @Transactional(readOnly=true) public List<TransferTaskView> list(UUID actor,int limit){return repository.list(actor,Math.max(1,Math.min(limit,100)),0);}
    @Transactional(readOnly=true) public TransferTaskPageView page(UUID actor,int limit,int offset){int count=Math.max(1,Math.min(limit,50)),start=Math.max(0,Math.min(offset,1_000_000));List<TransferTaskView> rows=repository.list(actor,count+1,start);boolean more=rows.size()>count;List<TransferTaskView> items=List.copyOf(rows.subList(0,Math.min(rows.size(),count)));return new TransferTaskPageView(items,start+items.size(),more);}
    @Transactional(readOnly=true) public TransferArtifact download(UUID actor,UUID id){TransferTaskView value=get(actor,id);if(value.expiresAt()!=null&&value.expiresAt().isBefore(OffsetDateTime.now(clock)))throw new ResourceNotFoundException();TransferArtifact artifact=repository.artifact(id);if(artifact==null||artifact.bytes()==null)throw new ResourceNotFoundException();return artifact;}

    private void ensureNotCancelled(UUID taskId) {
        if (repository.cancellationRequested(taskId)) {
            throw new ContentTransferCancellationException();
        }
    }

    private ObjectNode cancelledReport(TransferTaskView task) {
        ObjectNode report = task.report() instanceof ObjectNode object
                ? object.deepCopy()
                : mapper.createObjectNode();
        report.put("cancelled", true);
        report.put("message", "Cancelled by the requesting user");
        return report;
    }

    private List<ImportDocument> parse(String format,String filename,byte[] bytes){return switch(format){case"MARKDOWN","TXT"->List.of(document(title(filename),new String(bytes,StandardCharsets.UTF_8),filename));case"HTML"->List.of(document(title(filename),Jsoup.parse(new String(bytes,StandardCharsets.UTF_8)).text(),filename));case"DOCX"->List.of(docx(filename,bytes));case"XLSX"->List.of(xlsx(filename,bytes));case"ZIP"->zip(bytes);case"NOTION"->notion(bytes);case"CONFLUENCE"->confluence(bytes);default->throw new IllegalArgumentException("Import format is invalid");};}
    private ImportDocument docx(String filename,byte[] bytes){try(var doc=new XWPFDocument(new ByteArrayInputStream(bytes))){String text=doc.getParagraphs().stream().map(p->p.getText()).filter(v->!v.isBlank()).reduce((a,b)->a+"\n"+b).orElse("");return document(title(filename),text,filename);}catch(IOException e){throw new IllegalArgumentException("DOCX file is invalid",e);}}
    private ImportDocument xlsx(String filename,byte[] bytes){try(var workbook=WorkbookFactory.create(new ByteArrayInputStream(bytes))){ObjectNode root=mapper.createObjectNode();root.put("type","workbook");ArrayNode sheets=root.putArray("sheets");DataFormatter formatter=new DataFormatter(Locale.ROOT);for(var sheet:workbook){ObjectNode s=sheets.addObject();s.put("name",sheet.getSheetName());ArrayNode rows=s.putArray("rows");sheet.forEach(row->{ArrayNode cells=rows.addArray();row.forEach(cell->cells.add(formatter.formatCellValue(cell)));});}return new ImportDocument(title(filename),ContentType.SPREADSHEET,root,filename);}catch(IOException e){throw new IllegalArgumentException("XLSX file is invalid",e);}}
    private List<ImportDocument> zip(byte[] bytes){List<ImportDocument> result=new ArrayList<>();for(ArchiveFile file:archive(bytes)){String lower=file.name().toLowerCase(Locale.ROOT);if(!(lower.endsWith(".md")||lower.endsWith(".markdown")||lower.endsWith(".txt")||lower.endsWith(".html")||lower.endsWith(".htm")))continue;String raw=new String(file.bytes(),StandardCharsets.UTF_8);String text=lower.endsWith(".html")||lower.endsWith(".htm")?Jsoup.parse(raw).text():raw;result.add(document(title(file.name()),text,file.name()));}if(result.isEmpty())throw new IllegalArgumentException("ZIP contains no supported documents");return result;}
    private List<ImportDocument> notion(byte[] bytes){List<ImportDocument> result=new ArrayList<>();for(ArchiveFile file:archive(bytes)){String lower=file.name().toLowerCase(Locale.ROOT);String raw=new String(file.bytes(),StandardCharsets.UTF_8);if(lower.endsWith(".md")||lower.endsWith(".markdown")||lower.endsWith(".txt"))result.add(document(title(file.name()),raw,file.name()));else if(lower.endsWith(".html")||lower.endsWith(".htm"))result.add(document(title(file.name()),Jsoup.parse(raw).text(),file.name()));else if(lower.endsWith(".csv"))result.add(databaseCsv(file.name(),raw));}if(result.isEmpty())throw new IllegalArgumentException("Notion archive contains no supported pages or databases");return result;}
    private List<ImportDocument> confluence(byte[] bytes){List<ImportDocument> result=new ArrayList<>();for(ArchiveFile file:archive(bytes)){String lower=file.name().toLowerCase(Locale.ROOT);String raw=new String(file.bytes(),StandardCharsets.UTF_8);if(lower.endsWith(".html")||lower.endsWith(".htm"))result.add(document(title(file.name()),Jsoup.parse(raw).text(),file.name()));else if(lower.endsWith("entities.xml")){var objects=Pattern.compile("<object\\s+class=\"Page\"[\\s\\S]*?</object>",Pattern.CASE_INSENSITIVE).matcher(raw);while(objects.find()){String object=objects.group();String pageTitle=xmlProperty(object,"title");String body=xmlProperty(object,"body");if(pageTitle!=null&&body!=null)result.add(document(pageTitle,Jsoup.parse(body).text(),file.name()+"#"+pageTitle));}}}if(result.isEmpty())throw new IllegalArgumentException("Confluence archive contains no supported pages");return result;}
    private ImportDocument databaseCsv(String filename,String raw){List<List<String>> rows=parseCsv(raw);if(rows.isEmpty())throw new IllegalArgumentException("Notion database CSV is empty");ObjectNode root=mapper.createObjectNode();root.put("type","database");ArrayNode fields=root.putArray("fields");List<String> headers=rows.get(0);List<String> ids=new ArrayList<>();for(int i=0;i<headers.size();i++){String id="field-"+i;ids.add(id);fields.addObject().put("id",id).put("name",headers.get(i).isBlank()?"Column "+(i+1):headers.get(i)).put("type","TEXT");}ArrayNode output=root.putArray("rows");for(int r=1;r<rows.size();r++){ObjectNode row=output.addObject();row.put("id",Ids.next().toString());row.put("createdAt",OffsetDateTime.now(clock).toString());ObjectNode values=row.putObject("values");for(int c=0;c<Math.min(ids.size(),rows.get(r).size());c++)values.put(ids.get(c),rows.get(r).get(c));}root.put("view","TABLE");root.put("filter","");root.putNull("sortFieldId");return new ImportDocument(title(filename),ContentType.DATABASE,root,filename);}
    private static List<List<String>> parseCsv(String raw){List<List<String>> rows=new ArrayList<>();List<String> row=new ArrayList<>();StringBuilder value=new StringBuilder();boolean quoted=false;for(int i=0;i<raw.length();i++){char ch=raw.charAt(i);if(ch=='\"'){if(quoted&&i+1<raw.length()&&raw.charAt(i+1)=='\"'){value.append('\"');i++;}else quoted=!quoted;}else if(ch==','&&!quoted){row.add(value.toString());value.setLength(0);}else if((ch=='\n'||ch=='\r')&&!quoted){if(ch=='\r'&&i+1<raw.length()&&raw.charAt(i+1)=='\n')i++;row.add(value.toString());value.setLength(0);if(!row.stream().allMatch(String::isBlank))rows.add(row);row=new ArrayList<>();}else value.append(ch);}row.add(value.toString());if(!row.stream().allMatch(String::isBlank))rows.add(row);return rows;}
    private List<ArchiveFile> archive(byte[] bytes){List<ArchiveFile> files=new ArrayList<>();long total=0;int count=0;try(var zip=new ZipInputStream(new ByteArrayInputStream(bytes),StandardCharsets.UTF_8)){for(ZipEntry entry;(entry=zip.getNextEntry())!=null;){if(entry.isDirectory())continue;if(++count>MAX_ZIP_ENTRIES)throw new IllegalArgumentException("ZIP contains too many files");String name=safeZipEntry(entry.getName());ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];for(int n;(n=zip.read(buffer))>=0;){total+=n;if(total>MAX_UNCOMPRESSED)throw new IllegalArgumentException("ZIP expands beyond the allowed size");out.write(buffer,0,n);}files.add(new ArchiveFile(name,out.toByteArray()));}}catch(IOException e){throw new IllegalArgumentException("ZIP file is invalid",e);}return files;}
    private static String xmlProperty(String object,String name){var matcher=Pattern.compile("<property\\s+name=\""+Pattern.quote(name)+"\"[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:]]>)?</property>",Pattern.CASE_INSENSITIVE).matcher(object);return matcher.find()?matcher.group(1).trim():null;}
    private ImportDocument document(String title,String text,String source){ObjectNode root=mapper.createObjectNode();root.put("type","doc");ArrayNode content=root.putArray("content");for(String line:text.split("\\R",-1)){ObjectNode p=content.addObject();p.put("type","paragraph");p.put("text",line);}return new ImportDocument(title,ContentType.DOCUMENT,root,source);}

    private TransferArtifact generate(ContentTransferRepository.PageSnapshot page,String format,Watermark watermark){if(!"DOCUMENT".equals(page.contentType()))return structuredExports.generate(page,format,watermark.enabled(),watermark.text(),watermark.position(),watermark.opacity());String markdown=withMarkdownWatermark(cardExports.markdown(page.plainText()),watermark);String plain=cardExports.plainText(page.plainText());try{return switch(format){case"MARKDOWN"->new TransferArtifact(file(page.title(),"md"),"text/markdown; charset=utf-8",markdown.getBytes(StandardCharsets.UTF_8));case"HTML"->new TransferArtifact(file(page.title(),"html"),"text/html; charset=utf-8",html(page,plain,watermark).getBytes(StandardCharsets.UTF_8));case"DOCX"->docxExport(page,plain,watermark);case"PDF"->pdf(page,plain,watermark);case"JPG"->image(page,plain,watermark);default->throw new IllegalArgumentException("Export format is invalid");};}catch(IOException e){throw new IllegalStateException("Export generation failed",e);}}
    private String html(ContentTransferRepository.PageSnapshot page,String plain,Watermark watermark){String mark=watermark.enabled()?"<div class=\"export-watermark "+watermark.position().toLowerCase(Locale.ROOT)+"\">"+escape(watermark.text())+"</div>":"";return "<!doctype html><meta charset=\"utf-8\"><title>"+escape(page.title())+"</title><style>body{font:16px/1.8 system-ui;max-width:860px;margin:50px auto;padding:0 24px}.export-watermark{position:fixed;color:#6b8173;opacity:"+watermark.opacity()+";pointer-events:none}.export-watermark.footer{right:24px;bottom:18px}.export-watermark.center,.export-watermark.tiled{left:50%;top:50%;transform:translate(-50%,-50%) rotate(-24deg)}</style>"+mark+"<article><h1>"+escape(page.title())+"</h1><p>"+escape(plain).replace("\n","</p><p>")+"</p></article>";}
    private TransferArtifact docxExport(ContentTransferRepository.PageSnapshot page,String plain,Watermark watermark)throws IOException{try(var doc=new XWPFDocument();var out=new ByteArrayOutputStream()){doc.createParagraph().createRun().setText(page.title());for(String line:plain.split("\\R"))doc.createParagraph().createRun().setText(line);if(watermark.enabled()){var run=doc.createParagraph().createRun();run.setText(watermark.text());run.setColor("6B8173");run.setItalic(true);run.setFontSize(9);}doc.write(out);return new TransferArtifact(file(page.title(),"docx"),"application/vnd.openxmlformats-officedocument.wordprocessingml.document",out.toByteArray());}}
    private TransferArtifact pdf(ContentTransferRepository.PageSnapshot page,String plain,Watermark watermark)throws IOException{try(var doc=new PDDocument();var out=new ByteArrayOutputStream()){List<String> lines=wrap(ascii(page.title()+"\n"+plain),90);for(int offset=0;offset<Math.max(1,lines.size());offset+=48){PDPage pdfPage=new PDPage(PDRectangle.A4);doc.addPage(pdfPage);try(var stream=new PDPageContentStream(doc,pdfPage)){stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),12);stream.beginText();stream.newLineAtOffset(48,790);for(String line:lines.subList(offset,Math.min(lines.size(),offset+48))){stream.showText(line);stream.newLineAtOffset(0,-15);}stream.endText();drawPdfWatermark(stream,watermark);}}doc.save(out);return new TransferArtifact(file(page.title(),"pdf"),"application/pdf",out.toByteArray());}}
    private void drawPdfWatermark(PDPageContentStream stream,Watermark watermark)throws IOException{if(!watermark.enabled())return;stream.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),9);stream.setNonStrokingColor(new Color(145,157,149));String text=ascii(watermark.text());if("TILED".equals(watermark.position())){for(int y=120;y<760;y+=180){stream.beginText();stream.newLineAtOffset(90,y);stream.showText(text);stream.endText();}}else{stream.beginText();stream.newLineAtOffset("CENTER".equals(watermark.position())?210:48,"CENTER".equals(watermark.position())?410:24);stream.showText(text);stream.endText();}}
    private TransferArtifact image(ContentTransferRepository.PageSnapshot page,String plain,Watermark watermark)throws IOException{int width=1280,height=Math.min(8000,Math.max(720,180+plain.length()/45*28));BufferedImage image=new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB);Graphics2D g=image.createGraphics();g.setColor(Color.WHITE);g.fillRect(0,0,width,height);g.setColor(new Color(35,39,43));g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING,RenderingHints.VALUE_TEXT_ANTIALIAS_ON);g.setFont(new Font(Font.SANS_SERIF,Font.BOLD,34));g.drawString(page.title(),64,80);g.setFont(new Font(Font.SANS_SERIF,Font.PLAIN,20));int y=135;for(String line:wrap(plain,70)){if(y>height-40)break;g.drawString(line,64,y);y+=29;}if(watermark.enabled()){g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER,(float)watermark.opacity()));g.setColor(new Color(45,86,60));g.setFont(new Font(Font.SANS_SERIF,Font.BOLD,18));if("TILED".equals(watermark.position()))for(int markY=180;markY<height;markY+=240)for(int x=100;x<width;x+=420)g.drawString(watermark.text(),x,markY);else g.drawString(watermark.text(),"CENTER".equals(watermark.position())?width/2-140:width-420,"CENTER".equals(watermark.position())?height/2:height-28);}g.dispose();ByteArrayOutputStream out=new ByteArrayOutputStream();ImageIO.write(image,"jpg",out);return new TransferArtifact(file(page.title(),"jpg"),"image/jpeg",out.toByteArray());}
    private byte[] knowledgeBaseZip(UUID kb,List<ContentTransferRepository.PageSnapshot> pages,String email){try(var out=new ByteArrayOutputStream();var zip=new ZipOutputStream(out,StandardCharsets.UTF_8)){Set<String> names=new HashSet<>();boolean marked=false;for(var page:pages){String name=slug(page.title());if(!names.add(name))name+="-"+page.pageId().toString().substring(0,8);Watermark watermark=watermark(page.watermarkConfig(),email);marked|=watermark.enabled();zip.putNextEntry(new ZipEntry(name+".md"));zip.write(("# "+page.title()+"\n\n"+withMarkdownWatermark(cardExports.markdown(page.plainText()),watermark)).getBytes(StandardCharsets.UTF_8));zip.closeEntry();}zip.putNextEntry(new ZipEntry("manifest.json"));ObjectNode manifest=mapper.createObjectNode();manifest.put("knowledgeBaseId",kb.toString());manifest.put("pageCount",pages.size());manifest.put("watermarkApplied",marked);zip.write(mapper.writeValueAsBytes(manifest));zip.closeEntry();zip.finish();return out.toByteArray();}catch(IOException e){throw new IllegalStateException("Knowledge base export failed",e);}}

    private Watermark watermark(JsonNode config,String email){if(config==null||!config.path("enabled").asBoolean(false))return new Watermark(false,"","FOOTER",.12);JsonNode textNode=config.path("text");String text=(textNode.isString()?textNode.stringValue():"{{email}}").trim();if(text.isBlank())text="{{email}}";text=text.substring(0,Math.min(text.length(),120)).replace("{{email}}",email==null?"unknown-user":email);JsonNode positionNode=config.path("position");String position=(positionNode.isString()?positionNode.stringValue():"FOOTER").toUpperCase(Locale.ROOT);if(!Set.of("CENTER","TILED","FOOTER").contains(position))position="FOOTER";double opacity=Math.max(.05,Math.min(.4,config.path("opacity").asDouble(.12)));return new Watermark(true,text,position,opacity);}
    private static String withMarkdownWatermark(String value,Watermark watermark){return watermark.enabled()?value+"\n\n---\n> "+watermark.text():value;}

    private static void validateUpload(String format,String filename,byte[] bytes){if(bytes==null||bytes.length==0||bytes.length>MAX_UPLOAD)throw new IllegalArgumentException("Upload must be between 1 byte and 50 MiB");if(Set.of("ZIP","DOCX","XLSX","NOTION","CONFLUENCE").contains(format)&&(bytes.length<4||bytes[0]!='P'||bytes[1]!='K'))throw new IllegalArgumentException("Uploaded file magic does not match its format");safeFilename(filename);}
    private static Set<String> exportFormats(String contentType){return switch(ContentType.valueOf(contentType)){case DOCUMENT->Set.of("MARKDOWN","HTML","DOCX","PDF","JPG");case WHITEBOARD->Set.of("PNG","JPG","SVG","PDF");case SPREADSHEET->Set.of("XLSX","PDF");case DATABASE->Set.of("XLSX","CSV");};}
    private static String format(String requested,String filename,Set<String> allowed){String value=requested;if(value==null||value.isBlank()){String f=filename==null?"":filename.toLowerCase(Locale.ROOT);int dot=f.lastIndexOf('.');value=dot<0?"":f.substring(dot+1);if("MD".equalsIgnoreCase(value))value="MARKDOWN";}String normalized=value.toUpperCase(Locale.ROOT);if(!allowed.contains(normalized))throw new IllegalArgumentException("Content transfer format is unsupported");return normalized;}
    private static String safeFilename(String value){if(value==null||value.isBlank())return "upload";String normalized=value.replace('\\','/');if(normalized.contains("../")||normalized.startsWith("/")||normalized.indexOf('\0')>=0)throw new IllegalArgumentException("Filename is unsafe");String name=normalized.substring(normalized.lastIndexOf('/')+1);return name.substring(0,Math.min(name.length(),500));}
    private static String safeZipEntry(String value){String normalized=value.replace('\\','/');if(normalized.startsWith("/")||normalized.contains("../")||normalized.matches("^[A-Za-z]:.*"))throw new IllegalArgumentException("ZIP contains an unsafe path");return normalized;}
    private static String title(String filename){String name=safeFilename(filename);int dot=name.lastIndexOf('.');String value=dot>0?name.substring(0,dot):name;return value.isBlank()?"Imported document":value.substring(0,Math.min(value.length(),500));}
    private static String slug(String value){String normalized=value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+","-").replaceAll("^-|-$","");return normalized.isBlank()?"document":normalized.substring(0,Math.min(normalized.length(),120));}
    private static String file(String title,String extension){return slug(title)+"."+extension;}private static String escape(String v){return v.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;");}private static String ascii(String value){return value.replaceAll("[^\\x20-\\x7E\\n]","?");}private static List<String> wrap(String value,int width){List<String> result=new ArrayList<>();for(String original:value.split("\\R",-1)){String line=original;while(line.length()>width){result.add(line.substring(0,width));line=line.substring(width);}result.add(line);}return result;}private static String safeError(RuntimeException e){String v=e.getMessage()==null?"Import failed":e.getMessage();return v.substring(0,Math.min(v.length(),500));}
    private record ImportDocument(String title,ContentType type,JsonNode content,String source){}private record ArchiveFile(String name,byte[] bytes){}private record Watermark(boolean enabled,String text,String position,double opacity){}
}
