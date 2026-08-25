package io.knowledge.platform.template;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class TemplateRepository {
    private static final Table<Record> TEMPLATES = table(name("templates"));
    private final DSLContext dsl;
    private final ObjectMapper mapper;
    TemplateRepository(DSLContext dsl, ObjectMapper mapper) { this.dsl=dsl; this.mapper=mapper; }

    void insert(TemplateView value) {
        dsl.insertInto(TEMPLATES).columns(uuid("id"),uuid("workspace_id"),string("template_type"),string("name"),string("description"),string("category"),string("thumbnail"),uuid("source_resource_id"),json("snapshot"),string("visibility"),number("use_count"),uuid("created_by"),time("created_at"),time("updated_at"))
                .values(value.id(),value.workspaceId(),value.templateType(),value.name(),value.description(),value.category(),value.thumbnail(),value.sourceResourceId(),JSONB.valueOf(mapper.writeValueAsString(value.snapshot())),value.visibility(),value.useCount(),value.createdBy(),value.createdAt(),value.updatedAt()).execute();
    }
    TemplateView find(UUID id) { return select().and(uuid("id").eq(id)).fetchOne(this::map); }
    List<TemplateView> list(UUID workspaceId, UUID actorId, String type, String query, int limit, int offset) {
        var condition=uuid("workspace_id").eq(workspaceId).and(time("deleted_at").isNull())
                .and(string("visibility").eq("WORKSPACE").or(uuid("created_by").eq(actorId)));
        if(type!=null) condition=condition.and(string("template_type").eq(type));
        if(query!=null&&!query.isBlank()) condition=condition.and(string("name").containsIgnoreCase(query).or(string("description").containsIgnoreCase(query)));
        return select().and(condition).orderBy(number("use_count").desc(),time("updated_at").desc()).limit(limit).offset(offset).fetch(this::map);
    }
    void incrementUse(UUID id, OffsetDateTime now) { dsl.update(TEMPLATES).set(number("use_count"),number("use_count").add(1L)).set(time("updated_at"),now).where(uuid("id").eq(id)).execute(); }
    void delete(UUID id, OffsetDateTime now) { dsl.update(TEMPLATES).set(time("deleted_at"),now).where(uuid("id").eq(id)).execute(); }
    void insertInstance(UUID id, TemplateView template, String type, UUID targetId, JSONB mapping, UUID actor, OffsetDateTime now) {
        dsl.insertInto(table(name("template_instances"))).columns(uuid("id"),uuid("template_id"),uuid("workspace_id"),string("target_resource_type"),uuid("target_resource_id"),json("resource_mapping"),uuid("instantiated_by"),time("instantiated_at"))
                .values(id,template.id(),template.workspaceId(),type,targetId,mapping,actor,now).execute();
    }

    PageSnapshot page(UUID id) { return dsl.select(uuid("p.id"),string("p.title"),string("p.path"),string("p.icon"),string("p.cover"),string("p.content_type"),string("p.publish_mode"),string("p.visibility_override"),json("p.document_settings"),integer("p.schema_version"),json("d.content_json"))
            .from(table(name("pages")).as("p")).join(table(name("page_drafts")).as("d")).on(uuid("d.page_id").eq(uuid("p.id")))
            .where(uuid("p.id").eq(id).and(time("p.deleted_at").isNull())).fetchOne(r->new PageSnapshot(r.value1(),r.value2(),r.value3(),r.value4(),r.value5(),r.value6(),r.value7(),r.value8(),mapper.readTree(r.value9().data()),r.value10(),mapper.readTree(r.value11().data()))); }
    KnowledgeBaseSnapshot knowledgeBase(UUID id) { return dsl.select(uuid("id"),string("name"),string("slug"),string("description"),string("icon"),string("visibility"),bool("allow_public_index"),string("publish_mode"))
            .from(table(name("knowledge_bases"))).where(uuid("id").eq(id).and(time("archived_at").isNull())).fetchOne(r->new KnowledgeBaseSnapshot(r.value1(),r.value2(),r.value3(),r.value4(),r.value5(),r.value6(),Boolean.TRUE.equals(r.value7()),r.value8())); }
    List<PageSnapshot> pages(UUID knowledgeBaseId) { return dsl.select(uuid("p.id"),string("p.title"),string("p.path"),string("p.icon"),string("p.cover"),string("p.content_type"),string("p.publish_mode"),string("p.visibility_override"),json("p.document_settings"),integer("p.schema_version"),json("d.content_json"))
            .from(table(name("pages")).as("p")).join(table(name("page_drafts")).as("d")).on(uuid("d.page_id").eq(uuid("p.id")))
            .where(uuid("p.knowledge_base_id").eq(knowledgeBaseId).and(time("p.deleted_at").isNull())).orderBy(time("p.created_at"),uuid("p.id"))
            .fetch(r->new PageSnapshot(r.value1(),r.value2(),r.value3(),r.value4(),r.value5(),r.value6(),r.value7(),r.value8(),mapper.readTree(r.value9().data()),r.value10(),mapper.readTree(r.value11().data()))); }
    List<CatalogSnapshot> catalog(UUID knowledgeBaseId) { return dsl.select(uuid("id"),string("node_type"),uuid("page_id"),uuid("parent_id"),string("position"),string("title_override"),string("url"),json("metadata"))
            .from(table(name("catalog_nodes"))).where(uuid("knowledge_base_id").eq(knowledgeBaseId).and(time("deleted_at").isNull())).orderBy(string("position"))
            .fetch(r->new CatalogSnapshot(r.value1(),r.value2(),r.value3(),r.value4(),r.value5(),r.value6(),r.value7(),mapper.readTree(r.value8().data()))); }

    private org.jooq.SelectConditionStep<? extends Record> select(){ return dsl.select(uuid("id"),uuid("workspace_id"),string("template_type"),string("name"),string("description"),string("category"),string("thumbnail"),uuid("source_resource_id"),json("snapshot"),string("visibility"),number("use_count"),uuid("created_by"),time("created_at"),time("updated_at")).from(TEMPLATES).where(time("deleted_at").isNull()); }
    private TemplateView map(Record r){ return new TemplateView(r.get(uuid("id")),r.get(uuid("workspace_id")),r.get(string("template_type")),r.get(string("name")),r.get(string("description")),r.get(string("category")),r.get(string("thumbnail")),r.get(uuid("source_resource_id")),mapper.readTree(r.get(json("snapshot")).data()),r.get(string("visibility")),r.get(number("use_count")),r.get(uuid("created_by")),r.get(time("created_at")),r.get(time("updated_at"))); }
    record PageSnapshot(UUID id,String title,String path,String icon,String cover,String contentType,String publishMode,String visibility,JsonNode settings,int schemaVersion,JsonNode content){}
    record KnowledgeBaseSnapshot(UUID id,String name,String slug,String description,String icon,String visibility,boolean allowPublicIndex,String publishMode){}
    record CatalogSnapshot(UUID id,String nodeType,UUID pageId,UUID parentId,String position,String title,String url,JsonNode metadata){}
    private static org.jooq.Field<UUID> uuid(String v){return field(name(v.split("\\.")),UUID.class);} private static org.jooq.Field<String> string(String v){return field(name(v.split("\\.")),String.class);} private static org.jooq.Field<Long> number(String v){return field(name(v.split("\\.")),Long.class);} private static org.jooq.Field<Integer> integer(String v){return field(name(v.split("\\.")),Integer.class);} private static org.jooq.Field<Boolean> bool(String v){return field(name(v.split("\\.")),Boolean.class);} private static org.jooq.Field<OffsetDateTime> time(String v){return field(name(v.split("\\.")),OffsetDateTime.class);} private static org.jooq.Field<JSONB> json(String v){return field(name(v.split("\\.")),JSONB.class);}
}
