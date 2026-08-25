package io.knowledge.platform.contentioapi;

import io.knowledge.platform.contentio.ContentTransferService;
import io.knowledge.platform.contentio.ContentTransferDispatcher;
import io.knowledge.platform.contentio.TransferArtifact;
import io.knowledge.platform.contentio.TransferTaskView;
import io.knowledge.platform.contentio.TransferTaskPageView;
import io.knowledge.platform.security.PlatformPrincipal;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/content-transfers")
final class ContentTransferController {
    private final ContentTransferService service;
    private final ContentTransferDispatcher dispatcher;
    ContentTransferController(ContentTransferService service,ContentTransferDispatcher dispatcher){this.service=service;this.dispatcher=dispatcher;}
    @PostMapping(value="/imports/upload",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<TransferTaskView> upload(@RequestParam UUID knowledgeBaseId,@RequestParam(required=false) String format,@RequestPart MultipartFile file,@AuthenticationPrincipal PlatformPrincipal principal)throws IOException{TransferTaskView task=service.importFile(principal.userId(),knowledgeBaseId,format,file.getOriginalFilename(),file.getBytes());dispatcher.dispatch(task.id());return ResponseEntity.status(202).body(task);}
    @PostMapping("/exports/page") ResponseEntity<TransferTaskView> page(@RequestBody ContentTransferRequests.PageExport r,@AuthenticationPrincipal PlatformPrincipal p){TransferTaskView task=service.exportPage(p.userId(),r.pageId(),r.format(),Boolean.TRUE.equals(r.published()));dispatcher.dispatch(task.id());return ResponseEntity.status(202).body(task);}
    @PostMapping("/exports/knowledge-base") ResponseEntity<TransferTaskView> knowledgeBase(@RequestBody ContentTransferRequests.KnowledgeBaseExport r,@AuthenticationPrincipal PlatformPrincipal p){TransferTaskView task=service.exportKnowledgeBase(p.userId(),r.knowledgeBaseId());dispatcher.dispatch(task.id());return ResponseEntity.status(202).body(task);}
    @PostMapping("/get") TransferTaskView get(@RequestBody ContentTransferRequests.Id r,@AuthenticationPrincipal PlatformPrincipal p){return service.get(p.userId(),r.taskId());}
    @PostMapping("/list") List<TransferTaskView> list(@RequestBody ContentTransferRequests.ListTasks r,@AuthenticationPrincipal PlatformPrincipal p){return service.list(p.userId(),r.limit()==null?50:r.limit());}
    @PostMapping("/page") TransferTaskPageView tasksPage(@RequestBody ContentTransferRequests.ListTasks r,@AuthenticationPrincipal PlatformPrincipal p){return service.page(p.userId(),r.limit()==null?30:r.limit(),r.offset()==null?0:r.offset());}
    @PostMapping("/cancel") TransferTaskView cancel(@RequestBody ContentTransferRequests.Id r,@AuthenticationPrincipal PlatformPrincipal p){return service.cancel(p.userId(),r.taskId());}
    @GetMapping("/download") ResponseEntity<byte[]> download(@RequestParam UUID taskId,@AuthenticationPrincipal PlatformPrincipal p){TransferArtifact artifact=service.download(p.userId(),taskId);return ResponseEntity.ok().contentType(MediaType.parseMediaType(artifact.mediaType())).header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(artifact.filename(),java.nio.charset.StandardCharsets.UTF_8).build().toString()).body(artifact.bytes());}
}
