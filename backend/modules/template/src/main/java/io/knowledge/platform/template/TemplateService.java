package io.knowledge.platform.template;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationDeniedException;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.catalog.CatalogNodeType;
import io.knowledge.platform.catalog.CatalogService;
import io.knowledge.platform.catalog.CreateCatalogNodeCommand;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.knowledgebase.CreateKnowledgeBaseCommand;
import io.knowledge.platform.knowledgebase.KnowledgeBaseService;
import io.knowledge.platform.page.ContentType;
import io.knowledge.platform.page.CreatePageCommand;
import io.knowledge.platform.page.PageService;
import io.knowledge.platform.page.PageView;
import io.knowledge.platform.page.UpdatePageCommand;
import io.knowledge.platform.search.SearchDocumentCommand;
import io.knowledge.platform.search.SearchIndexWriter;
import java.net.URI;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jooq.JSONB;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

@Service
@SuppressWarnings("deprecation")
public class TemplateService {
    private final TemplateRepository repository;
    private final AuthorizationService authorization;
    private final KnowledgeBaseService knowledgeBases;
    private final PageService pages;
    private final CatalogService catalog;
    private final SearchIndexWriter searchIndex;
    private final AuditService audit;
    private final ObjectMapper mapper;
    private final Clock clock;

    public TemplateService(TemplateRepository repository, AuthorizationService authorization,
            KnowledgeBaseService knowledgeBases, PageService pages, CatalogService catalog,
            SearchIndexWriter searchIndex, AuditService audit, ObjectMapper mapper, Clock clock) {
        this.repository=repository; this.authorization=authorization; this.knowledgeBases=knowledgeBases;
        this.pages=pages; this.catalog=catalog; this.searchIndex=searchIndex; this.audit=audit;
        this.mapper=mapper; this.clock=clock;
    }

    @Transactional
    public TemplateView saveDocument(UUID actorId, UUID pageId, String name, String description, String category, String thumbnail, String visibility) {
        var access=authorization.require(actorId,ResourceType.PAGE,pageId,Capability.READ);
        var source=repository.page(pageId); if(source==null) throw new ResourceNotFoundException();
        ObjectNode snapshot=mapper.createObjectNode(); snapshot.put("snapshotVersion",1); snapshot.put("templateType","DOCUMENT"); snapshot.set("page",pageJson(source));
        return insert(actorId,access.workspaceId(),"DOCUMENT",pageId,name,description,category,thumbnail,visibility,snapshot);
    }

    @Transactional
    public TemplateView saveKnowledgeBase(UUID actorId, UUID knowledgeBaseId, String name, String description, String category, String thumbnail, String visibility) {
        var access=authorization.require(actorId,ResourceType.KNOWLEDGE_BASE,knowledgeBaseId,Capability.READ);
        var kb=repository.knowledgeBase(knowledgeBaseId); if(kb==null) throw new ResourceNotFoundException();
        ObjectNode snapshot=mapper.createObjectNode(); snapshot.put("snapshotVersion",1); snapshot.put("templateType","KNOWLEDGE_BASE");
        ObjectNode kbNode=snapshot.putObject("knowledgeBase"); kbNode.put("id",kb.id().toString()); kbNode.put("name",kb.name()); kbNode.put("slug",kb.slug()); put(kbNode,"description",kb.description()); put(kbNode,"icon",kb.icon()); kbNode.put("visibility",kb.visibility()); kbNode.put("allowPublicIndex",kb.allowPublicIndex()); kbNode.put("publishMode",kb.publishMode());
        ArrayNode pageNodes=snapshot.putArray("pages"); repository.pages(knowledgeBaseId).forEach(page->pageNodes.add(pageJson(page)));
        ArrayNode catalogNodes=snapshot.putArray("catalog"); repository.catalog(knowledgeBaseId).forEach(node->{ ObjectNode n=catalogNodes.addObject(); n.put("id",node.id().toString()); n.put("nodeType",node.nodeType()); put(n,"pageId",node.pageId()); put(n,"parentId",node.parentId()); n.put("position",node.position()); put(n,"title",node.title()); put(n,"url",node.url()); n.set("metadata",node.metadata()); });
        return insert(actorId,access.workspaceId(),"KNOWLEDGE_BASE",knowledgeBaseId,name,description,category,thumbnail,visibility,snapshot);
    }

    @Transactional(readOnly=true)
    public List<TemplateView> list(UUID actorId, UUID workspaceId, String type, String query, int limit, int offset) {
        authorization.require(actorId,ResourceType.WORKSPACE,workspaceId,Capability.READ);
        return repository.list(workspaceId,actorId,type(type,true),query,Math.max(1,Math.min(limit,100)),Math.max(0,offset));
    }

    @Transactional(readOnly=true) public TemplatePageView page(UUID actorId,UUID workspaceId,String type,String query,int limit,int offset){authorization.require(actorId,ResourceType.WORKSPACE,workspaceId,Capability.READ);int count=Math.max(1,Math.min(limit,50)),start=Math.max(0,Math.min(offset,1_000_000));List<TemplateView> rows=repository.list(workspaceId,actorId,type(type,true),query,count+1,start);boolean more=rows.size()>count;List<TemplateView> items=List.copyOf(rows.subList(0,Math.min(rows.size(),count)));return new TemplatePageView(items,start+items.size(),more);}
    @Transactional(readOnly=true) public TemplateView get(UUID actorId, UUID id){ return accessible(actorId,id); }

    @Transactional
    public TemplateInstanceView instantiateDocument(UUID actorId, UUID templateId, UUID knowledgeBaseId, String title, String path) {
        TemplateView template=accessible(actorId,templateId); if(!"DOCUMENT".equals(template.templateType())) throw new IllegalArgumentException("Document template is required");
        authorization.require(actorId,ResourceType.KNOWLEDGE_BASE,knowledgeBaseId,Capability.EDIT);
        JsonNode source=template.snapshot().path("page");
        PageView created=pages.create(actorId,new CreatePageCommand(knowledgeBaseId,text(title,500,source.path("title").asText()),path,
                ContentType.valueOf(source.path("contentType").asText()),nullable(source,"icon"),nullable(source,"cover"),source.path("publishMode").asText("INHERIT"),source.path("visibility").asText("INHERIT"),source.path("settings"),null));
        Map<UUID,UUID> mapping=Map.of(UUID.fromString(source.path("id").asText()),created.id());
        JsonNode content=rewrite(source.path("content"),mapping);
        pages.update(actorId,new UpdatePageCommand(created.id(),0,null,null,null,null,null,null,null,content,source.path("schemaVersion").asInt(1),"MIGRATION","Instantiated from template"));
        finishInstance(actorId,template,"PAGE",created.id(),mapping);
        return new TemplateInstanceView(template.id(),"PAGE",created.id(),mapping);
    }

    @Transactional
    public TemplateInstanceView instantiateKnowledgeBase(UUID actorId, UUID templateId, UUID workspaceId, String name, String slug) {
        TemplateView template=accessible(actorId,templateId); if(!"KNOWLEDGE_BASE".equals(template.templateType())) throw new IllegalArgumentException("Knowledge base template is required");
        authorization.require(actorId,ResourceType.WORKSPACE,workspaceId,Capability.MANAGE);
        JsonNode sourceKb=template.snapshot().path("knowledgeBase");
        var createdKb=knowledgeBases.create(actorId,new CreateKnowledgeBaseCommand(workspaceId,text(name,160,sourceKb.path("name").asText()),slug,
                nullable(sourceKb,"description"),nullable(sourceKb,"icon"),"WORKSPACE",workspaceId,sourceKb.path("visibility").asText("PRIVATE"),sourceKb.path("allowPublicIndex").asBoolean(false),sourceKb.path("publishMode").asText("MANUAL")));
        Map<UUID,UUID> mapping=new LinkedHashMap<>(); mapping.put(UUID.fromString(sourceKb.path("id").asText()),createdKb.id());
        List<PageDraft> drafts=new ArrayList<>();
        for(JsonNode source:template.snapshot().path("pages")) {
            PageView page=pages.create(actorId,new CreatePageCommand(createdKb.id(),source.path("title").asText(),uniquePath(source.path("path").asText()),ContentType.valueOf(source.path("contentType").asText()),nullable(source,"icon"),nullable(source,"cover"),source.path("publishMode").asText("INHERIT"),source.path("visibility").asText("INHERIT"),source.path("settings"),null));
            UUID old=UUID.fromString(source.path("id").asText()); mapping.put(old,page.id()); drafts.add(new PageDraft(page,source));
        }
        for(PageDraft draft:drafts) pages.update(actorId,new UpdatePageCommand(draft.page().id(),0,null,null,null,null,null,null,null,rewrite(draft.source().path("content"),mapping),draft.source().path("schemaVersion").asInt(1),"MIGRATION","Instantiated from knowledge base template"));
        recreateCatalog(actorId,createdKb.id(),template.snapshot().path("catalog"),mapping);
        finishInstance(actorId,template,"KNOWLEDGE_BASE",createdKb.id(),mapping);
        return new TemplateInstanceView(template.id(),"KNOWLEDGE_BASE",createdKb.id(),Map.copyOf(mapping));
    }

    @Transactional public void delete(UUID actorId,UUID id){ TemplateView value=accessible(actorId,id); if(!value.createdBy().equals(actorId)) authorization.require(actorId,ResourceType.WORKSPACE,value.workspaceId(),Capability.MANAGE); repository.delete(id,OffsetDateTime.now(clock)); searchIndex.delete(id); audit.success(value.workspaceId(),actorId,"template.delete","TEMPLATE",id); }

    private void recreateCatalog(UUID actorId,UUID kbId,JsonNode source,Map<UUID,UUID> mapping){
        Map<UUID,UUID> nodeMap=new HashMap<>(); Set<UUID> createdIds=new HashSet<>(); long revision=0; List<JsonNode> pending=new ArrayList<>(); source.forEach(pending::add);
        while(!pending.isEmpty()){ boolean progress=false; for(var iterator=pending.iterator();iterator.hasNext();){JsonNode item=iterator.next(); UUID oldParent=uuid(item,"parentId"); if(oldParent!=null&&!nodeMap.containsKey(oldParent)) continue; UUID oldId=UUID.fromString(item.path("id").asText()); UUID oldPage=uuid(item,"pageId"); var tree=catalog.create(actorId,new CreateCatalogNodeCommand(kbId,CatalogNodeType.valueOf(item.path("nodeType").asText()),oldPage==null?null:mapping.get(oldPage),oldParent==null?null:nodeMap.get(oldParent),null,null,nullable(item,"title"),nullable(item,"url"),item.path("metadata"),revision)); revision=tree.revision(); var added=tree.nodes().stream().filter(n->!createdIds.contains(n.id())).findFirst().orElseThrow(); createdIds.add(added.id()); nodeMap.put(oldId,added.id()); mapping.put(oldId,added.id()); iterator.remove(); progress=true;} if(!progress) throw new IllegalArgumentException("Template catalog contains an orphan or cycle"); }
    }

    private TemplateView insert(UUID actorId,UUID workspaceId,String type,UUID source,String name,String description,String category,String thumbnail,String visibility,JsonNode snapshot){ OffsetDateTime now=OffsetDateTime.now(clock); TemplateView value=new TemplateView(Ids.next(),workspaceId,type,text(name,160,null),optional(description,4000),optional(category,80),thumbnail(thumbnail),source,snapshot,visibility(visibility),0,actorId,now,now); repository.insert(value); index(value); audit.success(workspaceId,actorId,"template.create","TEMPLATE",value.id()); return value; }
    private TemplateView accessible(UUID actorId,UUID id){ TemplateView value=repository.find(id); if(value==null) throw new ResourceNotFoundException(); authorization.require(actorId,ResourceType.WORKSPACE,value.workspaceId(),Capability.READ); if("PRIVATE".equals(value.visibility())&&!actorId.equals(value.createdBy())) throw new AuthorizationDeniedException(); return value; }
    private void finishInstance(UUID actorId,TemplateView template,String targetType,UUID targetId,Map<UUID,UUID> mapping){ OffsetDateTime now=OffsetDateTime.now(clock); ObjectNode json=mapper.createObjectNode(); mapping.forEach((from,to)->json.put(from.toString(),to.toString())); repository.insertInstance(Ids.next(),template,targetType,targetId,JSONB.valueOf(mapper.writeValueAsString(json)),actorId,now); repository.incrementUse(template.id(),now); audit.success(template.workspaceId(),actorId,"template.instantiate",targetType,targetId); }
    private void index(TemplateView value){ ObjectNode metadata=mapper.createObjectNode(); metadata.put("templateType",value.templateType()); if(value.category()!=null) metadata.put("category",value.category()); if(value.thumbnail()!=null) metadata.put("thumbnail",value.thumbnail()); searchIndex.upsert(new SearchDocumentCommand(value.id(),value.workspaceId(),"TEMPLATE",value.id(),"CANONICAL",value.name(),value.description(),value.category()==null?List.of():List.of(value.category()),null,value.createdBy(),value.templateType(),value.visibility(),null,authorization.permissionVersion(value.workspaceId()),metadata,value.createdAt(),value.updatedAt())); }
    private ObjectNode pageJson(TemplateRepository.PageSnapshot p){ ObjectNode n=mapper.createObjectNode(); n.put("id",p.id().toString()); n.put("title",p.title()); n.put("path",p.path()); put(n,"icon",p.icon()); put(n,"cover",p.cover()); n.put("contentType",p.contentType()); n.put("publishMode",p.publishMode()); n.put("visibility",p.visibility()); n.set("settings",p.settings()); n.put("schemaVersion",p.schemaVersion()); n.set("content",p.content()); return n; }
    private JsonNode rewrite(JsonNode value,Map<UUID,UUID> mapping){ String json=mapper.writeValueAsString(value); for(var e:mapping.entrySet()) json=json.replace(e.getKey().toString(),e.getValue().toString()); return mapper.readTree(json); }
    private static String type(String v,boolean nullable){ if(v==null||v.isBlank()) return nullable?null:"DOCUMENT"; String n=v.toUpperCase(Locale.ROOT); if(!Set.of("DOCUMENT","KNOWLEDGE_BASE").contains(n)) throw new IllegalArgumentException("Template type is invalid"); return n; }
    private static String visibility(String v){ String n=v==null?"PRIVATE":v.toUpperCase(Locale.ROOT); if(!Set.of("PRIVATE","WORKSPACE").contains(n)) throw new IllegalArgumentException("Template visibility is invalid"); return n; }
    private static String text(String v,int max,String fallback){ String n=v==null||v.isBlank()?fallback:v.trim(); if(n==null||n.isBlank()||n.length()>max) throw new IllegalArgumentException("Template value is invalid"); return n; }
    private static String optional(String v,int max){ if(v==null||v.isBlank())return null; String n=v.trim(); if(n.length()>max)throw new IllegalArgumentException("Template value is too long");return n; }
    static String thumbnail(String value){ String normalized=optional(value,2000); if(normalized==null)return null; try{URI uri=URI.create(normalized);if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new IllegalArgumentException("Template thumbnail URL is invalid");return uri.toASCIIString();}catch(RuntimeException exception){throw new IllegalArgumentException("Template thumbnail URL is invalid");} }
    private static String nullable(JsonNode n,String f){return n.hasNonNull(f)&&!n.path(f).asText().isBlank()?n.path(f).asText():null;} private static UUID uuid(JsonNode n,String f){String v=nullable(n,f);return v==null?null:UUID.fromString(v);} private static void put(ObjectNode n,String f,Object v){if(v!=null)n.put(f,v.toString());else n.putNull(f);} private static String uniquePath(String value){return value+"-"+Ids.next().toString().substring(0,8);}
    private record PageDraft(PageView page,JsonNode source){}
}
