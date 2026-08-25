package io.knowledge.platform.integrationapi;

import io.knowledge.platform.integration.ExternalApiModels.WebhookCreate;
import io.knowledge.platform.integration.OpenPlatformViews.Webhook;

import io.knowledge.platform.catalog.CatalogTreeView;import io.knowledge.platform.integration.CredentialIdentity;import io.knowledge.platform.integration.ExternalApiModels.DocumentCreate;import io.knowledge.platform.integration.ExternalApiModels.DocumentUpdate;import io.knowledge.platform.integration.ExternalApiService;import io.knowledge.platform.knowledgebase.KnowledgeBaseView;import io.knowledge.platform.page.PageView;import io.knowledge.platform.search.SearchResponse;import io.knowledge.platform.team.TeamView;import io.knowledge.platform.workspace.WorkspaceMemberView;import io.knowledge.platform.workspace.WorkspaceView;import jakarta.servlet.http.HttpServletRequest;import java.util.List;import java.util.Set;import java.util.UUID;import org.springframework.http.ResponseEntity;import org.springframework.web.bind.annotation.GetMapping;import org.springframework.web.bind.annotation.PatchMapping;import org.springframework.web.bind.annotation.PathVariable;import org.springframework.web.bind.annotation.PostMapping;import org.springframework.web.bind.annotation.RequestBody;import org.springframework.web.bind.annotation.RequestHeader;import org.springframework.web.bind.annotation.RequestMapping;import org.springframework.web.bind.annotation.RequestParam;import org.springframework.web.bind.annotation.RestController;

@RestController @RequestMapping("/api/v2")
final class ExternalApiController {
    private final ExternalApiService service;ExternalApiController(ExternalApiService service){this.service=service;}
    @GetMapping("/workspaces") List<WorkspaceView> workspaces(HttpServletRequest request){return service.workspaces(identity(request));}
    @GetMapping("/users") List<WorkspaceMemberView> users(@RequestParam UUID workspaceId,HttpServletRequest request){return service.users(identity(request),workspaceId);}
    @GetMapping("/teams") List<TeamView> teams(@RequestParam UUID workspaceId,HttpServletRequest request){return service.teams(identity(request),workspaceId);}
    @GetMapping("/knowledge-bases") List<KnowledgeBaseView> knowledgeBases(@RequestParam UUID workspaceId,HttpServletRequest request){return service.knowledgeBases(identity(request),workspaceId);}
    @GetMapping("/documents") List<PageView> documents(@RequestParam UUID knowledgeBaseId,HttpServletRequest request){return service.documents(identity(request),knowledgeBaseId);}
    @GetMapping("/documents/{pageId}") PageView document(@PathVariable UUID pageId,HttpServletRequest request){return service.document(identity(request),pageId);}
    @PostMapping("/documents") ResponseEntity<PageView> create(@RequestBody DocumentCreate body,@RequestHeader("Idempotency-Key")String key,HttpServletRequest request){return ResponseEntity.status(201).body(service.createDocument(identity(request),key,body));}
    @PatchMapping("/documents/{pageId}") PageView update(@PathVariable UUID pageId,@RequestBody DocumentUpdate body,@RequestHeader("Idempotency-Key")String key,HttpServletRequest request){DocumentUpdate value=new DocumentUpdate(pageId,body.expectedRevision(),body.title(),body.path(),body.icon(),body.cover(),body.publishMode(),body.visibilityOverride(),body.documentSettings(),body.content(),body.schemaVersion(),body.revisionKind(),body.revisionDescription());return service.updateDocument(identity(request),key,value);}
    @GetMapping("/catalog") CatalogTreeView catalog(@RequestParam UUID knowledgeBaseId,HttpServletRequest request){return service.catalog(identity(request),knowledgeBaseId);}
    @GetMapping("/search") SearchResponse search(@RequestParam UUID workspaceId,@RequestParam("q")String query,@RequestParam(required=false)Set<String> types,@RequestParam(defaultValue="0")int offset,@RequestParam(defaultValue="20")int limit,HttpServletRequest request){return service.search(identity(request),workspaceId,query,types,offset,limit);}
    @GetMapping("/webhooks") List<Webhook> webhooks(@RequestParam UUID workspaceId,HttpServletRequest request){return service.webhooks(identity(request),workspaceId);}
    @PostMapping("/webhooks") ResponseEntity<Webhook> createWebhook(@RequestBody WebhookCreate body,@RequestHeader("Idempotency-Key")String key,HttpServletRequest request){return ResponseEntity.status(201).body(service.createWebhook(identity(request),key,body));}
    private static CredentialIdentity identity(HttpServletRequest request){return (CredentialIdentity)request.getAttribute(OpenPlatformAuthenticationFilter.IDENTITY_ATTRIBUTE);}
}
