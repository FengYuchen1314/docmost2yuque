package io.knowledge.platform.catalog;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.common.Ids;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

@Repository
class CatalogRepository {

    private static final Table<Record> NODES = table(name("catalog_nodes"));
    private static final Table<Record> REVISIONS = table(name("catalog_revisions"));
    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    CatalogRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    long currentRevision(UUID knowledgeBaseId) {
        Long revision = dsl.select(number("catalog_revision"))
                .from(table(name("knowledge_bases")))
                .where(uuid("id")
                        .eq(knowledgeBaseId)
                        .and(time("archived_at").isNull()))
                .fetchOne(number("catalog_revision"));
        if (revision == null) {
            throw new ResourceNotFoundException();
        }
        return revision;
    }

    long incrementRevision(UUID knowledgeBaseId, long expectedRevision, OffsetDateTime now) {
        Long revision = dsl.update(table(name("knowledge_bases")))
                .set(number("catalog_revision"), expectedRevision + 1)
                .set(time("updated_at"), now)
                .where(uuid("id")
                        .eq(knowledgeBaseId)
                        .and(number("catalog_revision").eq(expectedRevision))
                        .and(time("archived_at").isNull()))
                .returning(number("catalog_revision"))
                .fetchOne(number("catalog_revision"));
        return revision == null ? -1 : revision;
    }

    CatalogNodeView find(UUID nodeId) {
        return selectActive()
                .and(field(name("cn", "id"), UUID.class).eq(nodeId))
                .fetchOne(this::map);
    }

    List<CatalogNodeView> list(UUID knowledgeBaseId) {
        return selectActive()
                .and(field(name("cn", "knowledge_base_id"), UUID.class)
                        .eq(knowledgeBaseId))
                .orderBy(
                        field(name("cn", "parent_id"), UUID.class).asc().nullsFirst(),
                        field(name("cn", "position"), String.class).asc())
                .fetch(this::map);
    }

    List<Sibling> siblingsForUpdate(UUID knowledgeBaseId, UUID parentId, UUID excludedNodeId) {
        var condition = uuid("knowledge_base_id")
                .eq(knowledgeBaseId)
                .and(time("deleted_at").isNull());
        condition = parentId == null
                ? condition.and(uuid("parent_id").isNull())
                : condition.and(uuid("parent_id").eq(parentId));
        if (excludedNodeId != null) {
            condition = condition.and(uuid("id").ne(excludedNodeId));
        }
        return dsl.select(uuid("id"), string("position"))
                .from(NODES)
                .where(condition)
                .orderBy(string("position").asc())
                .forUpdate()
                .fetch(record -> new Sibling(record.value1(), record.value2()));
    }

    void rebalance(List<Sibling> siblings, OffsetDateTime now, UUID actorId) {
        List<String> ranks = CatalogRank.evenlySpaced(siblings.size());
        for (int index = 0; index < siblings.size(); index++) {
            dsl.update(NODES)
                    .set(string("position"), ranks.get(index))
                    .set(uuid("updated_by"), actorId)
                    .set(time("updated_at"), now)
                    .where(uuid("id").eq(siblings.get(index).id()))
                    .execute();
        }
    }

    void insert(CatalogNodeView node) {
        dsl.insertInto(NODES)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("knowledge_base_id"),
                        string("node_type"),
                        uuid("page_id"),
                        uuid("parent_id"),
                        string("position"),
                        string("title_override"),
                        string("url"),
                        json("metadata"),
                        uuid("created_by"),
                        uuid("updated_by"),
                        time("created_at"),
                        time("updated_at"))
                .values(
                        node.id(),
                        node.workspaceId(),
                        node.knowledgeBaseId(),
                        node.nodeType().name(),
                        node.pageId(),
                        node.parentId(),
                        node.position(),
                        node.titleOverride(),
                        node.url(),
                        JSONB.valueOf(objectMapper.writeValueAsString(node.metadata())),
                        node.createdBy(),
                        node.updatedBy(),
                        node.createdAt(),
                        node.updatedAt())
                .execute();
    }

    void rename(UUID nodeId, String title, OffsetDateTime now, UUID actorId) {
        int changed = dsl.update(NODES)
                .set(string("title_override"), title)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(nodeId).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void move(
            UUID nodeId,
            UUID targetParentId,
            String position,
            OffsetDateTime now,
            UUID actorId) {
        int changed = dsl.update(NODES)
                .set(uuid("parent_id"), targetParentId)
                .set(string("position"), position)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(nodeId).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void remove(UUID nodeId, OffsetDateTime now, UUID actorId) {
        int changed = dsl.update(NODES)
                .set(time("deleted_at"), now)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("id").eq(nodeId).and(time("deleted_at").isNull()))
                .execute();
        requireChanged(changed);
    }

    void removeAll(Collection<UUID> nodeIds, OffsetDateTime now, UUID actorId) {
        if (nodeIds.isEmpty()) return;
        int changed = dsl.update(NODES)
                .set(time("deleted_at"), now)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("id").in(nodeIds).and(time("deleted_at").isNull()))
                .execute();
        if (changed != nodeIds.size()) {
            throw new ResourceNotFoundException();
        }
    }

    boolean hasChildren(UUID nodeId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(NODES)
                .where(uuid("parent_id").eq(nodeId).and(time("deleted_at").isNull())));
    }

    boolean pageBelongs(UUID knowledgeBaseId, UUID pageId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("pages")))
                .where(uuid("id")
                        .eq(pageId)
                        .and(uuid("knowledge_base_id").eq(knowledgeBaseId))
                        .and(time("deleted_at").isNull())));
    }

    boolean isDescendant(UUID nodeId, UUID possibleDescendantId) {
        Record result = dsl.fetch(
                "with recursive descendants(id) as ("
                        + "select id from catalog_nodes where parent_id = ? and deleted_at is null "
                        + "union all select n.id from catalog_nodes n join descendants d "
                        + "on n.parent_id = d.id where n.deleted_at is null) "
                        + "select count(*) from descendants where id = ?",
                nodeId,
                possibleDescendantId)
                .get(0);
        Integer count = result.get(0, Integer.class);
        return count != null && count > 0;
    }

    void insertRevision(
            UUID workspaceId,
            UUID knowledgeBaseId,
            long revision,
            String operation,
            UUID actorId,
            OffsetDateTime now) {
        JSONB snapshot = dsl.select(field(
                        "coalesce(jsonb_agg(jsonb_build_object("
                                + "'id', id, 'nodeType', node_type, 'pageId', page_id, "
                                + "'parentId', parent_id, 'position', position, "
                                + "'titleOverride', title_override, 'url', url, 'metadata', metadata) "
                                + "order by parent_id nulls first, position), '[]'::jsonb)",
                        JSONB.class))
                .from(NODES)
                .where(uuid("knowledge_base_id")
                        .eq(knowledgeBaseId)
                        .and(time("deleted_at").isNull()))
                .fetchOne(0, JSONB.class);
        dsl.insertInto(REVISIONS)
                .columns(
                        uuid("id"),
                        uuid("workspace_id"),
                        uuid("knowledge_base_id"),
                        number("revision_no"),
                        string("operation"),
                        json("snapshot"),
                        uuid("actor_id"),
                        time("created_at"))
                .values(
                        Ids.next(),
                        workspaceId,
                        knowledgeBaseId,
                        revision,
                        operation,
                        snapshot,
                        actorId,
                        now)
                .execute();
    }

    List<CatalogRevisionView> revisions(UUID knowledgeBaseId, int limit, int offset) {
        return dsl.select(
                        uuid("id"),
                        uuid("knowledge_base_id"),
                        number("revision_no"),
                        string("operation"),
                        json("snapshot"),
                        uuid("actor_id"),
                        time("created_at"))
                .from(REVISIONS)
                .where(uuid("knowledge_base_id").eq(knowledgeBaseId))
                .orderBy(number("revision_no").desc())
                .limit(Math.max(1, Math.min(limit, 200)))
                .offset(Math.max(0, offset))
                .fetch(record -> new CatalogRevisionView(
                        record.value1(),
                        record.value2(),
                        record.value3(),
                        record.value4(),
                        objectMapper.readTree(record.value5().data()),
                        record.value6(),
                        record.value7()));
    }

    CatalogRevisionView revision(UUID knowledgeBaseId, long revisionNo) {
        return dsl.select(
                        uuid("id"), uuid("knowledge_base_id"), number("revision_no"),
                        string("operation"), json("snapshot"), uuid("actor_id"), time("created_at"))
                .from(REVISIONS)
                .where(uuid("knowledge_base_id").eq(knowledgeBaseId)
                        .and(number("revision_no").eq(revisionNo)))
                .fetchOne(record -> new CatalogRevisionView(
                        record.value1(), record.value2(), record.value3(), record.value4(),
                        objectMapper.readTree(record.value5().data()), record.value6(), record.value7()));
    }

    void restore(
            UUID workspaceId,
            UUID knowledgeBaseId,
            List<CatalogNodeView> nodes,
            UUID actorId,
            OffsetDateTime now) {
        dsl.update(NODES)
                .set(time("deleted_at"), now)
                .set(uuid("updated_by"), actorId)
                .set(time("updated_at"), now)
                .where(uuid("knowledge_base_id").eq(knowledgeBaseId)
                        .and(time("deleted_at").isNull()))
                .execute();
        for (CatalogNodeView node : nodes) {
            dsl.insertInto(NODES)
                    .columns(
                            uuid("id"), uuid("workspace_id"), uuid("knowledge_base_id"),
                            string("node_type"), uuid("page_id"), uuid("parent_id"),
                            string("position"), string("title_override"), string("url"),
                            json("metadata"), uuid("created_by"), uuid("updated_by"),
                            time("created_at"), time("updated_at"), time("deleted_at"))
                    .values(
                            node.id(), workspaceId, knowledgeBaseId, node.nodeType().name(),
                            node.pageId(), node.parentId(), node.position(), node.titleOverride(),
                            node.url(), JSONB.valueOf(objectMapper.writeValueAsString(node.metadata())),
                            actorId, actorId, now, now, null)
                    .onConflict(uuid("id"))
                    .doUpdate()
                    .set(uuid("workspace_id"), workspaceId)
                    .set(uuid("knowledge_base_id"), knowledgeBaseId)
                    .set(string("node_type"), node.nodeType().name())
                    .set(uuid("page_id"), node.pageId())
                    .set(uuid("parent_id"), node.parentId())
                    .set(string("position"), node.position())
                    .set(string("title_override"), node.titleOverride())
                    .set(string("url"), node.url())
                    .set(json("metadata"), JSONB.valueOf(objectMapper.writeValueAsString(node.metadata())))
                    .set(uuid("updated_by"), actorId)
                    .set(time("updated_at"), now)
                    .set(time("deleted_at"), (OffsetDateTime) null)
                    .execute();
        }
    }

    private org.jooq.SelectConditionStep<? extends Record> selectActive() {
        return dsl.select(
                        field(name("cn", "id"), UUID.class),
                        field(name("cn", "workspace_id"), UUID.class),
                        field(name("cn", "knowledge_base_id"), UUID.class),
                        field(name("cn", "node_type"), String.class),
                        field(name("cn", "page_id"), UUID.class),
                        field(name("cn", "parent_id"), UUID.class),
                        field(name("cn", "position"), String.class),
                        field(name("cn", "title_override"), String.class),
                        field(name("cn", "url"), String.class),
                        field(name("cn", "metadata"), JSONB.class),
                        field(name("cn", "created_by"), UUID.class),
                        field(name("cn", "updated_by"), UUID.class),
                        field(name("cn", "created_at"), OffsetDateTime.class),
                        field(name("cn", "updated_at"), OffsetDateTime.class))
                .from(table(name("catalog_nodes")).as("cn"))
                .where(field(name("cn", "deleted_at"), OffsetDateTime.class).isNull());
    }

    private CatalogNodeView map(Record record) {
        return new CatalogNodeView(
                record.get(field(name("cn", "id"), UUID.class)),
                record.get(field(name("cn", "workspace_id"), UUID.class)),
                record.get(field(name("cn", "knowledge_base_id"), UUID.class)),
                CatalogNodeType.valueOf(record.get(field(name("cn", "node_type"), String.class))),
                record.get(field(name("cn", "page_id"), UUID.class)),
                record.get(field(name("cn", "parent_id"), UUID.class)),
                record.get(field(name("cn", "position"), String.class)),
                record.get(field(name("cn", "title_override"), String.class)),
                record.get(field(name("cn", "url"), String.class)),
                objectMapper.readTree(record.get(field(name("cn", "metadata"), JSONB.class)).data()),
                record.get(field(name("cn", "created_by"), UUID.class)),
                record.get(field(name("cn", "updated_by"), UUID.class)),
                record.get(field(name("cn", "created_at"), OffsetDateTime.class)),
                record.get(field(name("cn", "updated_at"), OffsetDateTime.class)));
    }

    private static org.jooq.Field<UUID> uuid(String value) {
        return field(name(value), UUID.class);
    }

    private static org.jooq.Field<String> string(String value) {
        return field(name(value), String.class);
    }

    private static org.jooq.Field<OffsetDateTime> time(String value) {
        return field(name(value), OffsetDateTime.class);
    }

    private static org.jooq.Field<Long> number(String value) {
        return field(name(value), Long.class);
    }

    private static org.jooq.Field<JSONB> json(String value) {
        return field(name(value), JSONB.class);
    }

    private static void requireChanged(int changed) {
        if (changed != 1) {
            throw new ResourceNotFoundException();
        }
    }

    record Sibling(UUID id, String position) {}
}
