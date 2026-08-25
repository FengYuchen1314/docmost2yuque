package io.knowledge.platform.knowledgebase;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.common.Ids;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

@Repository
class KnowledgeBaseMergeRepository {

    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    KnowledgeBaseMergeRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    List<MergeKnowledgeBase> pair(UUID first, UUID second) {
        return dsl.select(
                        uuid("id"), uuid("workspace_id"), string("name"), string("slug"),
                        time("updated_at"), number("catalog_revision"), time("archived_at"))
                .from(table(name("knowledge_bases")))
                .where(uuid("id").in(first, second))
                .orderBy(uuid("id").asc())
                .fetch(record -> new MergeKnowledgeBase(
                        record.value1(), record.value2(), record.value3(), record.value4(),
                        record.value5(), record.value6(), record.value7()));
    }

    List<MergeKnowledgeBase> lockPair(UUID first, UUID second) {
        return dsl.select(
                        uuid("id"), uuid("workspace_id"), string("name"), string("slug"),
                        time("updated_at"), number("catalog_revision"), time("archived_at"))
                .from(table(name("knowledge_bases")))
                .where(uuid("id").in(first, second))
                .orderBy(uuid("id").asc())
                .forUpdate()
                .fetch(record -> new MergeKnowledgeBase(
                        record.value1(), record.value2(), record.value3(), record.value4(),
                        record.value5(), record.value6(), record.value7()));
    }

    List<MergePage> pages(UUID knowledgeBaseId) {
        return dsl.select(
                        uuid("id"), string("title"), string("path"), time("updated_at"),
                        time("deleted_at"))
                .from(table(name("pages")))
                .where(uuid("knowledge_base_id").eq(knowledgeBaseId))
                .orderBy(string("path").asc(), uuid("id").asc())
                .fetch(record -> new MergePage(
                        record.value1(), record.value2(), record.value3(),
                        record.value4(), record.value5()));
    }

    List<String> paths(UUID knowledgeBaseId) {
        return dsl.select(string("path"))
                .from(table(name("pages")))
                .where(uuid("knowledge_base_id").eq(knowledgeBaseId))
                .fetch(string("path"));
    }

    MergeCounts counts(UUID knowledgeBaseId) {
        int activePages = dsl.fetchCount(
                table(name("pages")), uuid("knowledge_base_id").eq(knowledgeBaseId)
                        .and(time("deleted_at").isNull()));
        int catalogNodes = dsl.fetchCount(
                table(name("catalog_nodes")), uuid("knowledge_base_id").eq(knowledgeBaseId)
                        .and(time("deleted_at").isNull()));
        int publications = dsl.fetchCount(
                table(name("page_publications")), uuid("knowledge_base_id").eq(knowledgeBaseId));
        int members = dsl.fetchCount(
                table(name("knowledge_base_members")), uuid("knowledge_base_id").eq(knowledgeBaseId));
        int shares = dsl.fetchCount(
                table(name("shares")), string("resource_type").eq("KNOWLEDGE_BASE")
                        .and(uuid("resource_id").eq(knowledgeBaseId))
                        .and(time("revoked_at").isNull()));
        return new MergeCounts(activePages, catalogNodes, publications, members, shares);
    }

    KnowledgeBaseMergeResult completed(
            UUID targetKnowledgeBaseId,
            UUID requestedBy,
            String idempotencyKey) {
        JSONB value = dsl.select(field(name("result_json"), JSONB.class))
                .from(table(name("knowledge_base_merges")))
                .where(uuid("target_knowledge_base_id").eq(targetKnowledgeBaseId)
                        .and(uuid("requested_by").eq(requestedBy))
                        .and(string("idempotency_key").eq(idempotencyKey)))
                .fetchOne(field(name("result_json"), JSONB.class));
        return value == null
                ? null
                : objectMapper.readValue(value.data(), KnowledgeBaseMergeResult.class);
    }

    MergeMutation apply(
            MergeKnowledgeBase source,
            MergeKnowledgeBase target,
            List<KnowledgeBaseMergePath> paths,
            UUID catalogGroupId,
            String catalogGroupPosition,
            UUID actorId,
            OffsetDateTime now) {
        for (KnowledgeBaseMergePath path : paths) {
            if (path.renamed()) {
                dsl.update(table(name("pages")))
                        .set(string("path"), path.resolvedPath())
                        .set(time("updated_at"), now)
                        .set(uuid("updated_by"), actorId)
                        .where(uuid("id").eq(path.pageId())
                                .and(uuid("knowledge_base_id").eq(source.id())))
                        .execute();
            }
        }

        int mergedMembers = mergeMembers(source.id(), target.id(), now);
        int revokedShares = dsl.update(table(name("shares")))
                .set(time("revoked_at"), now)
                .set(time("updated_at"), now)
                .where(string("resource_type").eq("KNOWLEDGE_BASE")
                        .and(uuid("resource_id").eq(source.id()))
                        .and(time("revoked_at").isNull()))
                .execute();

        mergeAcl(source.id(), target.id(), now);
        mergeRelationshipTables(source.id(), target.id());
        mergeEngagement(source.id(), target.id());
        mergeAnalytics(source.id(), target.id(), target.workspaceId(), now);

        dsl.update(table(name("page_histories")))
                .set(uuid("knowledge_base_id"), target.id())
                .where(uuid("knowledge_base_id").eq(source.id()))
                .execute();
        int movedPages = dsl.update(table(name("pages")))
                .set(uuid("knowledge_base_id"), target.id())
                .where(uuid("knowledge_base_id").eq(source.id()))
                .execute();
        dsl.execute(
                "select relocate_page_publications_for_merge(?::uuid, ?::uuid)",
                source.id(), target.id());

        int movedCatalogNodes = dsl.fetchCount(
                table(name("catalog_nodes")), uuid("knowledge_base_id").eq(source.id())
                        .and(time("deleted_at").isNull()));
        long catalogRevision = target.catalogRevision();
        if (movedCatalogNodes > 0) {
            dsl.insertInto(table(name("catalog_nodes")))
                    .columns(
                            uuid("id"), uuid("workspace_id"), uuid("knowledge_base_id"),
                            string("node_type"), uuid("page_id"), uuid("parent_id"),
                            string("position"), string("title_override"), string("url"),
                            field(name("metadata"), JSONB.class), uuid("created_by"),
                            uuid("updated_by"), time("created_at"), time("updated_at"))
                    .values(
                            catalogGroupId, target.workspaceId(), target.id(), "GROUP", null, null,
                            catalogGroupPosition, "来自「" + source.name() + "」", null,
                            JSONB.valueOf("{\"mergeSourceId\":\"" + source.id() + "\"}"),
                            actorId, actorId, now, now)
                    .execute();
            dsl.update(table(name("catalog_nodes")))
                    .set(uuid("parent_id"), catalogGroupId)
                    .set(uuid("updated_by"), actorId)
                    .set(time("updated_at"), now)
                    .where(uuid("knowledge_base_id").eq(source.id())
                            .and(uuid("parent_id").isNull())
                            .and(time("deleted_at").isNull()))
                    .execute();
            dsl.update(table(name("catalog_nodes")))
                    .set(uuid("knowledge_base_id"), target.id())
                    .set(uuid("workspace_id"), target.workspaceId())
                    .where(uuid("knowledge_base_id").eq(source.id()))
                    .execute();
            Long next = dsl.update(table(name("knowledge_bases")))
                    .set(number("catalog_revision"), number("catalog_revision").plus(1L))
                    .set(time("updated_at"), now)
                    .where(uuid("id").eq(target.id()))
                    .returning(number("catalog_revision"))
                    .fetchOne(number("catalog_revision"));
            catalogRevision = next == null ? target.catalogRevision() : next;
            insertCatalogRevision(target, catalogRevision, actorId, now);
        } else {
            dsl.update(table(name("knowledge_bases")))
                    .set(time("updated_at"), now)
                    .where(uuid("id").eq(target.id()))
                    .execute();
        }

        updateSearchDocuments(source.id(), target.id());
        dsl.deleteFrom(table(name("search_documents")))
                .where(string("resource_type").eq("KNOWLEDGE_BASE")
                        .and(uuid("resource_id").eq(source.id())))
                .execute();
        dsl.update(table(name("knowledge_bases")))
                .set(time("archived_at"), now)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(source.id()).and(time("archived_at").isNull()))
                .execute();
        return new MergeMutation(
                movedPages, movedCatalogNodes, mergedMembers, revokedShares, catalogRevision);
    }

    void save(
            KnowledgeBaseMergeResult result,
            UUID workspaceId,
            String fingerprint,
            String idempotencyKey,
            UUID requestedBy) {
        dsl.insertInto(table(name("knowledge_base_merges")))
                .columns(
                        uuid("id"), uuid("workspace_id"), uuid("source_knowledge_base_id"),
                        uuid("target_knowledge_base_id"), string("idempotency_key"),
                        string("plan_fingerprint"), field(name("result_json"), JSONB.class),
                        uuid("requested_by"), time("completed_at"))
                .values(
                        result.mergeId(), workspaceId, result.sourceKnowledgeBaseId(),
                        result.targetKnowledgeBaseId(), idempotencyKey, fingerprint,
                        JSONB.valueOf(objectMapper.writeValueAsString(result)), requestedBy,
                        result.completedAt())
                .execute();
    }

    String lastRootPosition(UUID knowledgeBaseId) {
        return dsl.select(string("position"))
                .from(table(name("catalog_nodes")))
                .where(uuid("knowledge_base_id").eq(knowledgeBaseId)
                        .and(uuid("parent_id").isNull())
                        .and(time("deleted_at").isNull()))
                .orderBy(string("position").desc())
                .limit(1)
                .fetchOne(string("position"));
    }

    private int mergeMembers(UUID sourceId, UUID targetId, OffsetDateTime now) {
        List<MemberRole> sourceMembers = dsl.select(uuid("user_id"), string("role"))
                .from(table(name("knowledge_base_members")))
                .where(uuid("knowledge_base_id").eq(sourceId))
                .fetch(record -> new MemberRole(record.value1(), record.value2()));
        for (MemberRole member : sourceMembers) {
            String current = dsl.select(string("role"))
                    .from(table(name("knowledge_base_members")))
                    .where(uuid("knowledge_base_id").eq(targetId)
                            .and(uuid("user_id").eq(member.userId())))
                    .fetchOne(string("role"));
            String role = strongerRole(current, member.role());
            dsl.insertInto(table(name("knowledge_base_members")))
                    .columns(uuid("knowledge_base_id"), uuid("user_id"), string("role"),
                            time("created_at"), time("updated_at"))
                    .values(targetId, member.userId(), role, now, now)
                    .onConflict(uuid("knowledge_base_id"), uuid("user_id"))
                    .doUpdate()
                    .set(string("role"), role)
                    .set(time("updated_at"), now)
                    .execute();
        }
        dsl.deleteFrom(table(name("knowledge_base_members")))
                .where(uuid("knowledge_base_id").eq(sourceId))
                .execute();
        return sourceMembers.size();
    }

    private void mergeAcl(UUID sourceId, UUID targetId, OffsetDateTime now) {
        dsl.execute(
                "update acl_entries s set deleted_at=?::timestamptz,updated_at=?::timestamptz "
                        + "where s.resource_type='KNOWLEDGE_BASE' and s.resource_id=? and s.deleted_at is null "
                        + "and exists(select 1 from acl_entries t where t.resource_type='KNOWLEDGE_BASE' "
                        + "and t.resource_id=? and t.deleted_at is null and t.subject_type=s.subject_type "
                        + "and t.subject_id is not distinct from s.subject_id)",
                now, now, sourceId, targetId);
        dsl.update(table(name("acl_entries")))
                .set(uuid("resource_id"), targetId)
                .set(time("updated_at"), now)
                .where(string("resource_type").eq("KNOWLEDGE_BASE")
                        .and(uuid("resource_id").eq(sourceId))
                        .and(time("deleted_at").isNull()))
                .execute();
    }

    private void mergeRelationshipTables(UUID sourceId, UUID targetId) {
        mergeJoinTable("knowledge_base_user_group_items", "group_id", sourceId, targetId);
        mergeJoinTable("garden_knowledge_bases", "garden_id", sourceId, targetId);
        dsl.execute(
                "delete from social_follows s where s.target_type='KNOWLEDGE_BASE' and s.target_id=? "
                        + "and exists(select 1 from social_follows t where t.follower_id=s.follower_id "
                        + "and t.target_type='KNOWLEDGE_BASE' and t.target_id=?)",
                sourceId, targetId);
        dsl.execute(
                "update social_follows set target_id=? where target_type='KNOWLEDGE_BASE' and target_id=?",
                targetId, sourceId);
    }

    private void mergeJoinTable(String tableName, String ownerColumn, UUID sourceId, UUID targetId) {
        dsl.execute(
                "delete from " + tableName + " s where s.knowledge_base_id=? and exists(select 1 from "
                        + tableName + " t where t." + ownerColumn + "=s." + ownerColumn
                        + " and t.knowledge_base_id=?)",
                sourceId, targetId);
        dsl.execute(
                "update " + tableName + " set knowledge_base_id=? where knowledge_base_id=?",
                targetId, sourceId);
    }

    private void mergeEngagement(UUID sourceId, UUID targetId) {
        dsl.execute(
                "delete from favorites s where s.resource_type='KNOWLEDGE_BASE' and s.resource_id=? "
                        + "and exists(select 1 from favorites t where t.user_id=s.user_id "
                        + "and t.resource_type='KNOWLEDGE_BASE' and t.resource_id=?)",
                sourceId, targetId);
        dsl.execute(
                "update favorites set resource_id=? where resource_type='KNOWLEDGE_BASE' and resource_id=?",
                targetId, sourceId);
        dsl.execute(
                "update activity_events set resource_id=? where resource_type='KNOWLEDGE_BASE' and resource_id=?",
                targetId, sourceId);
        dsl.execute(
                "update notifications set resource_id=? where resource_type='KNOWLEDGE_BASE' and resource_id=?",
                targetId, sourceId);
    }

    private void mergeAnalytics(
            UUID sourceId,
            UUID targetId,
            UUID workspaceId,
            OffsetDateTime now) {
        dsl.execute(
                "update content_events set knowledge_base_id=?,resource_id=case when resource_type='KNOWLEDGE_BASE' and resource_id=? then ? else resource_id end where knowledge_base_id=?",
                targetId, sourceId, targetId, sourceId);
        dsl.execute(
                "insert into daily_content_metrics(workspace_id,resource_type,resource_id,metric_date,views,unique_views,edits,comments,shares,exports,reactions,updated_at) "
                        + "select workspace_id,resource_type,?,metric_date,views,unique_views,edits,comments,shares,exports,reactions,?::timestamptz from daily_content_metrics "
                        + "where workspace_id=? and resource_type='KNOWLEDGE_BASE' and resource_id=? "
                        + "on conflict(workspace_id,resource_type,resource_id,metric_date) do update set "
                        + "views=daily_content_metrics.views+excluded.views,unique_views=daily_content_metrics.unique_views+excluded.unique_views,"
                        + "edits=daily_content_metrics.edits+excluded.edits,comments=daily_content_metrics.comments+excluded.comments,"
                        + "shares=daily_content_metrics.shares+excluded.shares,exports=daily_content_metrics.exports+excluded.exports,"
                        + "reactions=daily_content_metrics.reactions+excluded.reactions,updated_at=excluded.updated_at",
                targetId, now, workspaceId, sourceId);
        dsl.execute(
                "delete from daily_content_metrics where workspace_id=? and resource_type='KNOWLEDGE_BASE' and resource_id=?",
                workspaceId, sourceId);
        dsl.execute(
                "insert into daily_metric_unique_visitors(workspace_id,resource_type,resource_id,metric_date,visitor_key,created_at) "
                        + "select workspace_id,resource_type,?,metric_date,visitor_key,created_at from daily_metric_unique_visitors "
                        + "where workspace_id=? and resource_type='KNOWLEDGE_BASE' and resource_id=? on conflict do nothing",
                targetId, workspaceId, sourceId);
        dsl.execute(
                "delete from daily_metric_unique_visitors where workspace_id=? and resource_type='KNOWLEDGE_BASE' and resource_id=?",
                workspaceId, sourceId);
    }

    private void updateSearchDocuments(UUID sourceId, UUID targetId) {
        dsl.execute(
                "update search_documents sd set metadata=jsonb_set(coalesce(sd.metadata,'{}'::jsonb),'{knowledgeBaseId}',to_jsonb(?::text),true),"
                        + "path=p.path,visibility=case when p.visibility_override='INHERIT' then kb.visibility else p.visibility_override end "
                        + "from pages p join knowledge_bases kb on kb.id=p.knowledge_base_id "
                        + "where sd.resource_type='PAGE' and sd.resource_id=p.id and p.knowledge_base_id=? "
                        + "and sd.metadata->>'knowledgeBaseId'=?",
                targetId.toString(), targetId, sourceId.toString());
    }

    private void insertCatalogRevision(
            MergeKnowledgeBase target,
            long revision,
            UUID actorId,
            OffsetDateTime now) {
        JSONB snapshot = dsl.select(field(
                        "coalesce(jsonb_agg(jsonb_build_object("
                                + "'id',id,'nodeType',node_type,'pageId',page_id,'parentId',parent_id,"
                                + "'position',position,'titleOverride',title_override,'url',url,'metadata',metadata) "
                                + "order by parent_id nulls first,position),'[]'::jsonb)",
                        JSONB.class))
                .from(table(name("catalog_nodes")))
                .where(uuid("knowledge_base_id").eq(target.id())
                        .and(time("deleted_at").isNull()))
                .fetchOne(0, JSONB.class);
        dsl.insertInto(table(name("catalog_revisions")))
                .columns(
                        uuid("id"), uuid("workspace_id"), uuid("knowledge_base_id"),
                        number("revision_no"), string("operation"), field(name("snapshot"), JSONB.class),
                        uuid("actor_id"), time("created_at"))
                .values(
                        Ids.next(), target.workspaceId(), target.id(), revision,
                        "MERGE_SOURCE", snapshot, actorId, now)
                .execute();
    }

    private static String strongerRole(String left, String right) {
        List<String> roles = List.of("READER", "EDITOR", "MANAGER");
        if (left == null) return right;
        return roles.indexOf(left) >= roles.indexOf(right) ? left : right;
    }

    private static org.jooq.Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<String> string(String value) {
        return field(name(value), String.class);
    }

    private static org.jooq.Field<Long> number(String value) {
        return field(name(value), Long.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    record MergeKnowledgeBase(
            UUID id,
            UUID workspaceId,
            String name,
            String slug,
            OffsetDateTime updatedAt,
            long catalogRevision,
            OffsetDateTime archivedAt) {}

    record MergePage(
            UUID id,
            String title,
            String path,
            OffsetDateTime updatedAt,
            OffsetDateTime deletedAt) {}

    record MergeCounts(
            int activePages,
            int catalogNodes,
            int publications,
            int members,
            int shares) {}

    record MergeMutation(
            int movedPages,
            int movedCatalogNodes,
            int mergedMembers,
            int revokedShares,
            long catalogRevision) {}

    private record MemberRole(UUID userId, String role) {}
}
