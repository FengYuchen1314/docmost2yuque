package io.knowledge.platform.contentio;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.notExists;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class ContentTransferRepository {
    private static final Table<Record> TASKS=table(name("content_transfer_tasks"));
    private static final Table<Record> PAYLOADS=table(name("content_transfer_payloads"));
    private static final Table<Record> CANCELLATIONS=table(name("content_transfer_cancellation_requests"));
    private static final Field<Boolean> CANCEL_REQUESTED=field("content_transfer_tasks.status in ('PENDING','RUNNING') and exists (select 1 from content_transfer_cancellation_requests ctr where ctr.task_id = content_transfer_tasks.id)",Boolean.class);
    private final DSLContext dsl; private final ObjectMapper mapper;
    ContentTransferRepository(DSLContext dsl,ObjectMapper mapper){this.dsl=dsl;this.mapper=mapper;}
    void insert(UUID id,UUID workspaceId,String type,String format,String resourceType,UUID resourceId,String filename,UUID actor,JsonNode report,OffsetDateTime now){dsl.insertInto(TASKS).columns(uuid("id"),uuid("workspace_id"),string("task_type"),string("source_format"),string("resource_type"),uuid("resource_id"),string("status"),integer("progress"),string("original_filename"),json("report"),uuid("requested_by"),time("created_at")).values(id,workspaceId,type,format,resourceType,resourceId,"PENDING",0,filename,JSONB.valueOf(mapper.writeValueAsString(report==null?mapper.createObjectNode():report)),actor,now).execute();}
    void payload(UUID id,byte[] value,OffsetDateTime now){dsl.insertInto(PAYLOADS).columns(uuid("task_id"),bytes("payload"),time("created_at")).values(id,value,now).execute();}
    byte[] payload(UUID id){return dsl.select(bytes("payload")).from(PAYLOADS).where(uuid("task_id").eq(id)).fetchOne(bytes("payload"));}
    boolean claim(UUID id,OffsetDateTime now){return dsl.update(TASKS).set(string("status"),"RUNNING").set(integer("progress"),5).set(time("started_at"),now).where(uuid("id").eq(id).and(string("status").eq("PENDING")).and(notExists(dsl.selectOne().from(CANCELLATIONS).where(uuid("task_id").eq(id))))).execute()==1;}
    void progress(UUID id,int value){dsl.update(TASKS).set(integer("progress"),Math.max(0,Math.min(99,value))).where(uuid("id").eq(id).and(string("status").eq("RUNNING"))).execute();}
    List<UUID> pending(int limit){return dsl.select(uuid("id")).from(TASKS).where(string("status").eq("PENDING")).orderBy(time("created_at")).limit(limit).fetch(uuid("id"));}
    boolean success(UUID id,String filename,String mediaType,byte[] artifact,JsonNode report,OffsetDateTime now){boolean updated=dsl.update(TASKS).set(string("status"),"SUCCEEDED").set(integer("progress"),100).set(string("result_filename"),filename).set(string("result_media_type"),mediaType).set(bytes("artifact"),artifact).set(number("artifact_size"),(long)(artifact==null?0:artifact.length)).set(json("report"),JSONB.valueOf(mapper.writeValueAsString(report))).set(time("completed_at"),now).set(time("expires_at"),now.plusDays(7)).where(uuid("id").eq(id).and(string("status").eq("RUNNING")).and(notExists(dsl.selectOne().from(CANCELLATIONS).where(uuid("task_id").eq(id))))).execute()==1;if(updated){dsl.deleteFrom(PAYLOADS).where(uuid("task_id").eq(id)).execute();dsl.deleteFrom(CANCELLATIONS).where(uuid("task_id").eq(id)).execute();}return updated;}
    boolean failed(UUID id,JsonNode report,OffsetDateTime now){boolean updated=dsl.update(TASKS).set(string("status"),"FAILED").set(integer("progress"),100).set(json("report"),JSONB.valueOf(mapper.writeValueAsString(report))).set(time("completed_at"),now).where(uuid("id").eq(id).and(string("status").in("PENDING","RUNNING")).and(notExists(dsl.selectOne().from(CANCELLATIONS).where(uuid("task_id").eq(id))))).execute()==1;if(updated){dsl.deleteFrom(PAYLOADS).where(uuid("task_id").eq(id)).execute();dsl.deleteFrom(CANCELLATIONS).where(uuid("task_id").eq(id)).execute();}return updated;}
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public boolean requestCancellation(UUID id,UUID actor,OffsetDateTime now){return dsl.insertInto(CANCELLATIONS).columns(uuid("task_id"),uuid("requested_by"),time("requested_at")).values(id,actor,now).onConflict(uuid("task_id")).doNothing().execute()==1;}
    boolean cancellationRequested(UUID id){return dsl.fetchExists(dsl.selectOne().from(CANCELLATIONS).where(uuid("task_id").eq(id)));}
    void deleteCancellation(UUID id){dsl.deleteFrom(CANCELLATIONS).where(uuid("task_id").eq(id)).execute();}
    void cancelPending(UUID id,JsonNode report,OffsetDateTime now){boolean updated=dsl.update(TASKS).set(string("status"),"CANCELLED").set(integer("progress"),100).set(json("report"),JSONB.valueOf(mapper.writeValueAsString(report))).set(time("completed_at"),now).setNull(time("expires_at")).where(uuid("id").eq(id).and(string("status").eq("PENDING"))).execute()==1;if(updated)dsl.deleteFrom(PAYLOADS).where(uuid("task_id").eq(id)).execute();}
    void cancel(UUID id,JsonNode report,OffsetDateTime now){dsl.update(TASKS).set(string("status"),"CANCELLED").set(integer("progress"),100).set(json("report"),JSONB.valueOf(mapper.writeValueAsString(report))).set(time("completed_at"),now).setNull(time("expires_at")).where(uuid("id").eq(id).and(string("status").in("PENDING","RUNNING"))).execute();dsl.deleteFrom(PAYLOADS).where(uuid("task_id").eq(id)).execute();}
    TransferTaskView find(UUID id){return select().and(uuid("id").eq(id)).fetchOne(this::map);}
    List<TransferTaskView> list(UUID actor,int limit,int offset){return select().and(uuid("requested_by").eq(actor)).orderBy(time("created_at").desc(),uuid("id").desc()).limit(limit).offset(Math.max(0,offset)).fetch(this::map);}
    TransferArtifact artifact(UUID id){return dsl.select(string("result_filename"),string("result_media_type"),bytes("artifact")).from(TASKS).where(uuid("id").eq(id).and(string("status").eq("SUCCEEDED"))).fetchOne(r->new TransferArtifact(r.value1(),r.value2(),r.value3()));}
    String userEmail(UUID userId){return dsl.select(string("email_original")).from(table(name("users"))).where(uuid("id").eq(userId)).fetchOne(string("email_original"));}
    PageSnapshot page(UUID id,boolean published){
        if(published)return dsl.select(uuid("pp.workspace_id"),uuid("pp.knowledge_base_id"),uuid("pp.page_id"),string("pp.title_snapshot"),string("pp.content_type"),json("pp.content_snapshot"),string("pp.plain_text_snapshot"),time("pp.published_at"),json("kb.watermark_config"))
                .from(table(name("page_publications")).as("pp")).join(table(name("pages")).as("p")).on(uuid("p.published_revision_id").eq(uuid("pp.id"))).join(table(name("knowledge_bases")).as("kb")).on(uuid("kb.id").eq(uuid("pp.knowledge_base_id"))).where(uuid("pp.page_id").eq(id)).fetchOne(r->new PageSnapshot(r.value1(),r.value2(),r.value3(),r.value4(),r.value5(),mapper.readTree(r.value6().data()),r.value7(),r.value8(),read(r.value9())));
        return dsl.select(uuid("p.workspace_id"),uuid("p.knowledge_base_id"),uuid("p.id"),string("p.title"),string("p.content_type"),json("d.content_json"),string("d.plain_text"),time("p.updated_at"),json("kb.watermark_config"))
                .from(table(name("pages")).as("p")).join(table(name("page_drafts")).as("d")).on(uuid("d.page_id").eq(uuid("p.id"))).join(table(name("knowledge_bases")).as("kb")).on(uuid("kb.id").eq(uuid("p.knowledge_base_id"))).where(uuid("p.id").eq(id).and(time("p.deleted_at").isNull())).fetchOne(r->new PageSnapshot(r.value1(),r.value2(),r.value3(),r.value4(),r.value5(),mapper.readTree(r.value6().data()),r.value7(),r.value8(),read(r.value9())));
    }
    List<PageSnapshot> knowledgeBasePages(UUID kb){return dsl.select(uuid("p.workspace_id"),uuid("p.knowledge_base_id"),uuid("p.id"),string("p.title"),string("p.content_type"),json("d.content_json"),string("d.plain_text"),time("p.updated_at"),json("kb.watermark_config"))
            .from(table(name("pages")).as("p")).join(table(name("page_drafts")).as("d")).on(uuid("d.page_id").eq(uuid("p.id"))).join(table(name("knowledge_bases")).as("kb")).on(uuid("kb.id").eq(uuid("p.knowledge_base_id"))).where(uuid("p.knowledge_base_id").eq(kb).and(time("p.deleted_at").isNull())).orderBy(time("p.created_at")).fetch(r->new PageSnapshot(r.value1(),r.value2(),r.value3(),r.value4(),r.value5(),mapper.readTree(r.value6().data()),r.value7(),r.value8(),read(r.value9())));}
    private org.jooq.SelectConditionStep<? extends Record> select(){return dsl.select(uuid("id"),uuid("workspace_id"),string("task_type"),string("source_format"),string("resource_type"),uuid("resource_id"),string("status"),integer("progress"),string("original_filename"),string("result_filename"),string("result_media_type"),number("artifact_size"),json("report"),uuid("requested_by"),time("created_at"),time("started_at"),time("completed_at"),time("expires_at"),CANCEL_REQUESTED).from(TASKS).where(uuid("id").isNotNull());}
    private TransferTaskView map(Record r){JSONB report=r.get(json("report"));return new TransferTaskView(r.get(uuid("id")),r.get(uuid("workspace_id")),r.get(string("task_type")),r.get(string("source_format")),r.get(string("resource_type")),r.get(uuid("resource_id")),r.get(string("status")),r.get(integer("progress")),r.get(string("original_filename")),r.get(string("result_filename")),r.get(string("result_media_type")),r.get(number("artifact_size"))==null?0:r.get(number("artifact_size")),report==null?mapper.createObjectNode():mapper.readTree(report.data()),r.get(uuid("requested_by")),r.get(time("created_at")),r.get(time("started_at")),r.get(time("completed_at")),r.get(time("expires_at")),Boolean.TRUE.equals(r.get(CANCEL_REQUESTED)));}
    private JsonNode read(JSONB value){return value==null?mapper.createObjectNode():mapper.readTree(value.data());}
    record PageSnapshot(UUID workspaceId,UUID knowledgeBaseId,UUID pageId,String title,String contentType,JsonNode content,String plainText,OffsetDateTime updatedAt,JsonNode watermarkConfig){}
    private static org.jooq.Field<UUID> uuid(String v){return field(name(v.split("\\.")),UUID.class);}private static org.jooq.Field<String> string(String v){return field(name(v.split("\\.")),String.class);}private static org.jooq.Field<Integer> integer(String v){return field(name(v.split("\\.")),Integer.class);}private static org.jooq.Field<Long> number(String v){return field(name(v.split("\\.")),Long.class);}private static org.jooq.Field<OffsetDateTime> time(String v){return field(name(v.split("\\.")),OffsetDateTime.class);}private static org.jooq.Field<JSONB> json(String v){return field(name(v.split("\\.")),JSONB.class);}private static org.jooq.Field<byte[]> bytes(String v){return field(name(v.split("\\.")),byte[].class);}
}
