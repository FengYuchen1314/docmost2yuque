package io.knowledge.platform.attachment;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.sl.usermodel.Shape;
import org.apache.poi.sl.usermodel.TextShape;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.jsoup.Jsoup;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

@Component
final class AttachmentTextExtractor {
    private static final int MAX_INPUT_BYTES = 10 * 1024 * 1024;
    private static final int MAX_TEXT_CHARS = 500_000;

    Extraction extract(Resource resource,String originalName,String mediaType,long sizeBytes) {
        if (sizeBytes > MAX_INPUT_BYTES) return new Extraction("","TOO_LARGE");
        String format=format(originalName,mediaType);
        if (format==null) return new Extraction("","UNSUPPORTED");
        try(InputStream input=resource.getInputStream()) {
            byte[] bytes=input.readNBytes(MAX_INPUT_BYTES+1);
            if(bytes.length>MAX_INPUT_BYTES)return new Extraction("","TOO_LARGE");
            String text=switch(format){
                case "TEXT"->new String(bytes,StandardCharsets.UTF_8);
                case "HTML","XML"->markup(bytes);
                case "PDF"->pdf(bytes);
                case "DOCX"->docx(bytes);
                case "SHEET"->sheet(bytes);
                case "PPTX"->slides(bytes);
                default->"";
            };
            String normalized=normalize(text);
            return new Extraction(normalized,normalized.isBlank()?"EMPTY":"EXTRACTED");
        }catch(Exception exception){
            return new Extraction("","FAILED");
        }
    }

    private static String pdf(byte[] bytes)throws IOException{try(var document=Loader.loadPDF(bytes)){return new PDFTextStripper().getText(document);}}
    private static String markup(byte[] bytes){var document=Jsoup.parse(new String(bytes,StandardCharsets.UTF_8));document.select("script,style,noscript,template").remove();return document.text();}
    private static String docx(byte[] bytes)throws IOException{try(var document=new XWPFDocument(new ByteArrayInputStream(bytes));var extractor=new XWPFWordExtractor(document)){return extractor.getText();}}
    private static String sheet(byte[] bytes)throws IOException{try(var workbook=WorkbookFactory.create(new ByteArrayInputStream(bytes))){StringBuilder text=new StringBuilder();DataFormatter formatter=new DataFormatter(Locale.ROOT);outer:for(var worksheet:workbook){append(text,worksheet.getSheetName());for(var row:worksheet){for(var cell:row){append(text,formatter.formatCellValue(cell));if(text.length()>=MAX_TEXT_CHARS)break outer;}}}return text.toString();}}
    private static String slides(byte[] bytes)throws IOException{try(var deck=new XMLSlideShow(new ByteArrayInputStream(bytes))){StringBuilder text=new StringBuilder();outer:for(var slide:deck.getSlides()){for(Shape<?,?> shape:slide.getShapes()){if(shape instanceof TextShape<?,?> value)append(text,value.getText());if(text.length()>=MAX_TEXT_CHARS)break outer;}}return text.toString();}}
    private static void append(StringBuilder target,String value){if(value==null||value.isBlank()||target.length()>=MAX_TEXT_CHARS)return;if(!target.isEmpty())target.append('\n');target.append(value,0,Math.min(value.length(),MAX_TEXT_CHARS-target.length()));}
    private static String normalize(String value){if(value==null)return "";String normalized=value.replace('\u0000',' ').replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]"," ").replaceAll("[ \\t]+"," ").replaceAll("\\R{3,}","\n\n").strip();return normalized.length()>MAX_TEXT_CHARS?normalized.substring(0,MAX_TEXT_CHARS):normalized;}
    private static String format(String name,String mediaType){String filename=name==null?"":name.toLowerCase(Locale.ROOT);String type=mediaType==null?"":mediaType.toLowerCase(Locale.ROOT);if(type.contains("html")||ends(filename,".html",".htm"))return "HTML";if(type.contains("xml")||filename.endsWith(".xml"))return "XML";if(type.startsWith("text/")||ends(filename,".txt",".md",".markdown",".csv",".tsv",".log",".yaml",".yml")||type.contains("json")||type.contains("javascript"))return "TEXT";if(type.equals("application/pdf")||filename.endsWith(".pdf"))return "PDF";if(type.contains("wordprocessingml")||filename.endsWith(".docx"))return "DOCX";if(type.contains("spreadsheetml")||type.equals("application/vnd.ms-excel")||ends(filename,".xlsx",".xls"))return "SHEET";if(type.contains("presentationml")||filename.endsWith(".pptx"))return "PPTX";return null;}
    private static boolean ends(String value,String...suffixes){for(String suffix:suffixes)if(value.endsWith(suffix))return true;return false;}
    record Extraction(String text,String status){}
}
