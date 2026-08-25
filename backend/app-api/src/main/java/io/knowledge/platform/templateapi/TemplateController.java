package io.knowledge.platform.templateapi;

import io.knowledge.platform.security.PlatformPrincipal;
import io.knowledge.platform.template.TemplateInstanceView;
import io.knowledge.platform.template.TemplatePageView;
import io.knowledge.platform.template.TemplateService;
import io.knowledge.platform.template.TemplateView;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/templates")
final class TemplateController {
    private final TemplateService service;
    TemplateController(TemplateService service){this.service=service;}
    @PostMapping("/save-document") ResponseEntity<TemplateView> saveDocument(@RequestBody TemplateRequests.SaveDocument r,@AuthenticationPrincipal PlatformPrincipal p){return ResponseEntity.status(201).body(service.saveDocument(p.userId(),r.pageId(),r.name(),r.description(),r.category(),r.thumbnail(),r.visibility()));}
    @PostMapping("/save-knowledge-base") ResponseEntity<TemplateView> saveKnowledgeBase(@RequestBody TemplateRequests.SaveKnowledgeBase r,@AuthenticationPrincipal PlatformPrincipal p){return ResponseEntity.status(201).body(service.saveKnowledgeBase(p.userId(),r.knowledgeBaseId(),r.name(),r.description(),r.category(),r.thumbnail(),r.visibility()));}
    @PostMapping("/list") List<TemplateView> list(@RequestBody TemplateRequests.ListTemplates r,@AuthenticationPrincipal PlatformPrincipal p){return service.list(p.userId(),r.workspaceId(),r.templateType(),r.query(),r.limit()==null?50:r.limit(),r.offset()==null?0:r.offset());}
    @PostMapping("/page") TemplatePageView page(@RequestBody TemplateRequests.ListTemplates r,@AuthenticationPrincipal PlatformPrincipal p){return service.page(p.userId(),r.workspaceId(),r.templateType(),r.query(),r.limit()==null?24:r.limit(),r.offset()==null?0:r.offset());}
    @PostMapping("/get") TemplateView get(@RequestBody TemplateRequests.Id r,@AuthenticationPrincipal PlatformPrincipal p){return service.get(p.userId(),r.templateId());}
    @PostMapping("/instantiate-document") ResponseEntity<TemplateInstanceView> instantiateDocument(@RequestBody TemplateRequests.InstantiateDocument r,@AuthenticationPrincipal PlatformPrincipal p){return ResponseEntity.status(201).body(service.instantiateDocument(p.userId(),r.templateId(),r.knowledgeBaseId(),r.title(),r.path()));}
    @PostMapping("/instantiate-knowledge-base") ResponseEntity<TemplateInstanceView> instantiateKnowledgeBase(@RequestBody TemplateRequests.InstantiateKnowledgeBase r,@AuthenticationPrincipal PlatformPrincipal p){return ResponseEntity.status(201).body(service.instantiateKnowledgeBase(p.userId(),r.templateId(),r.workspaceId(),r.name(),r.slug()));}
    @PostMapping("/delete") ResponseEntity<Void> delete(@RequestBody TemplateRequests.Id r,@AuthenticationPrincipal PlatformPrincipal p){service.delete(p.userId(),r.templateId());return ResponseEntity.noContent().build();}
}
