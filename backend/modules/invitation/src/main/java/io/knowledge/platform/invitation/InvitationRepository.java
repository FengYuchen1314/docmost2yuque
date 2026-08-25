package io.knowledge.platform.invitation;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.Table;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Repository
class InvitationRepository {

    private static final Table<org.jooq.Record> INVITATIONS = table(name("invitations"));
    private static final Field<UUID> ID = field(name("id"), UUID.class);
    private static final Field<UUID> WORKSPACE_ID = field(name("workspace_id"), UUID.class);
    private static final Field<String> WORKSPACE_NAME = field(
            "(select w.name from workspaces w where w.id = invitations.workspace_id)",
            String.class);
    private static final Field<String> EMAIL_ORIGINAL =
            field(name("email_original"), String.class);
    private static final Field<String> EMAIL_NORMALIZED =
            field(name("email_normalized"), String.class);
    private static final Field<String> TOKEN_HASH = field(name("token_hash"), String.class);
    private static final Field<String> DELIVERY_TOKEN_ENCRYPTED =
            field(name("delivery_token_encrypted"), String.class);
    private static final Field<String> WORKSPACE_ROLE =
            field(name("workspace_role"), String.class);
    private static final Field<JSONB> TARGET_TEAM_IDS =
            field(name("target_team_ids"), JSONB.class);
    private static final Field<JSONB> TARGET_KNOWLEDGE_BASE_ROLES =
            field(name("target_knowledge_base_roles"), JSONB.class);
    private static final Field<String> STATUS = field(name("status"), String.class);
    private static final Field<Long> SMTP_SETTINGS_VERSION =
            field(name("smtp_settings_version"), Long.class);
    private static final Field<OffsetDateTime> EXPIRES_AT =
            field(name("expires_at"), OffsetDateTime.class);
    private static final Field<UUID> CREATED_BY = field(name("created_by"), UUID.class);
    private static final Field<OffsetDateTime> SENT_AT =
            field(name("sent_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> ACCEPTED_AT =
            field(name("accepted_at"), OffsetDateTime.class);
    private static final Field<UUID> ACCEPTED_BY = field(name("accepted_by"), UUID.class);
    private static final Field<OffsetDateTime> REVOKED_AT =
            field(name("revoked_at"), OffsetDateTime.class);
    private static final Field<String> LAST_DELIVERY_ERROR =
            field(name("last_delivery_error"), String.class);
    private static final Field<OffsetDateTime> CREATED_AT =
            field(name("created_at"), OffsetDateTime.class);
    private static final Field<OffsetDateTime> UPDATED_AT =
            field(name("updated_at"), OffsetDateTime.class);

    private final DSLContext dsl;
    private final ObjectMapper objectMapper;

    InvitationRepository(DSLContext dsl, ObjectMapper objectMapper) {
        this.dsl = dsl;
        this.objectMapper = objectMapper;
    }

    void revokeActive(UUID workspaceId, String emailNormalized, OffsetDateTime now) {
        dsl.update(INVITATIONS)
                .set(STATUS, "REVOKED")
                .set(REVOKED_AT, now)
                .set(DELIVERY_TOKEN_ENCRYPTED, (String) null)
                .set(UPDATED_AT, now)
                .where(WORKSPACE_ID.eq(workspaceId)
                        .and(EMAIL_NORMALIZED.eq(emailNormalized))
                        .and(STATUS.in("QUEUED", "SENT", "FAILED")))
                .execute();
    }

    void insert(
            UUID invitationId,
            UUID workspaceId,
            String emailOriginal,
            String emailNormalized,
            String tokenHash,
            String encryptedToken,
            String workspaceRole,
            List<UUID> targetTeamIds,
            List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles,
            long smtpSettingsVersion,
            OffsetDateTime expiresAt,
            UUID createdBy,
            OffsetDateTime now) {
        dsl.insertInto(INVITATIONS)
                .columns(
                        ID,
                        WORKSPACE_ID,
                        EMAIL_ORIGINAL,
                        EMAIL_NORMALIZED,
                        TOKEN_HASH,
                        DELIVERY_TOKEN_ENCRYPTED,
                        WORKSPACE_ROLE,
                        TARGET_TEAM_IDS,
                        TARGET_KNOWLEDGE_BASE_ROLES,
                        STATUS,
                        SMTP_SETTINGS_VERSION,
                        EXPIRES_AT,
                        CREATED_BY,
                        CREATED_AT,
                        UPDATED_AT)
                .values(
                        invitationId,
                        workspaceId,
                        emailOriginal,
                        emailNormalized,
                        tokenHash,
                        encryptedToken,
                        workspaceRole,
                        JSONB.valueOf(objectMapper.writeValueAsString(targetTeamIds)),
                        JSONB.valueOf(objectMapper.writeValueAsString(targetKnowledgeBaseRoles)),
                        "QUEUED",
                        smtpSettingsVersion,
                        expiresAt,
                        createdBy,
                        now,
                        now)
                .execute();
    }

    InvitationRecord findByTokenHashForUpdate(String tokenHash) {
        return selectInvitation()
                .and(TOKEN_HASH.eq(tokenHash))
                .forUpdate()
                .fetchOne(this::map);
    }

    InvitationRecord findByIdForUpdate(UUID invitationId) {
        return selectInvitation()
                .and(ID.eq(invitationId))
                .forUpdate()
                .fetchOne(this::map);
    }

    InvitationRecord findForDelivery(UUID invitationId) {
        return selectInvitation()
                .and(ID.eq(invitationId).and(STATUS.in("QUEUED", "FAILED")))
                .forUpdate()
                .fetchOne(this::map);
    }

    List<InvitationView> list(UUID workspaceId, int limit, int offset) {
        return dsl.select(
                        ID,
                        WORKSPACE_ID,
                        EMAIL_NORMALIZED,
                        WORKSPACE_ROLE,
                        TARGET_TEAM_IDS,
                        TARGET_KNOWLEDGE_BASE_ROLES,
                        STATUS,
                        EXPIRES_AT,
                        SENT_AT)
                .from(INVITATIONS)
                .where(WORKSPACE_ID.eq(workspaceId))
                .orderBy(CREATED_AT.desc(), ID.desc())
                .limit(limit)
                .offset(Math.max(0, offset))
                .fetch(record -> new InvitationView(
                        record.get(ID),
                        record.get(WORKSPACE_ID),
                        record.get(EMAIL_NORMALIZED),
                        record.get(WORKSPACE_ROLE),
                        teamIds(record.get(TARGET_TEAM_IDS)),
                        knowledgeBaseTargets(record.get(TARGET_KNOWLEDGE_BASE_ROLES)),
                        record.get(STATUS),
                        record.get(EXPIRES_AT),
                        record.get(SENT_AT)));
    }

    void markSent(UUID invitationId, String tokenHash, OffsetDateTime now) {
        dsl.update(INVITATIONS)
                .set(STATUS, "SENT")
                .set(SENT_AT, now)
                .set(LAST_DELIVERY_ERROR, (String) null)
                .set(UPDATED_AT, now)
                .where(ID.eq(invitationId)
                        .and(TOKEN_HASH.eq(tokenHash))
                        .and(STATUS.in("QUEUED", "FAILED")))
                .execute();
    }

    void markDeliveryFailed(
            UUID invitationId,
            String tokenHash,
            String errorCode,
            OffsetDateTime now) {
        dsl.update(INVITATIONS)
                .set(STATUS, "FAILED")
                .set(LAST_DELIVERY_ERROR, errorCode)
                .set(UPDATED_AT, now)
                .where(ID.eq(invitationId)
                        .and(TOKEN_HASH.eq(tokenHash))
                        .and(STATUS.in("QUEUED", "FAILED")))
                .execute();
    }

    void requireTargetsInWorkspace(
            UUID workspaceId,
            List<UUID> targetTeamIds,
            List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles) {
        if (!targetTeamIds.isEmpty()) {
            Table<Record> teams = table(name("teams"));
            Field<UUID> teamId = field(name("teams", "id"), UUID.class);
            int found = dsl.fetchCount(
                    teams,
                    field(name("teams", "workspace_id"), UUID.class)
                            .eq(workspaceId)
                            .and(teamId.in(targetTeamIds))
                            .and(field(name("teams", "deleted_at"), OffsetDateTime.class).isNull()));
            if (found != targetTeamIds.size()) {
                throw new IllegalArgumentException(
                        "Every invitation team must belong to the target workspace");
            }
        }
        List<UUID> knowledgeBaseIds = targetKnowledgeBaseRoles.stream()
                .map(InvitationKnowledgeBaseTarget::knowledgeBaseId)
                .toList();
        if (!knowledgeBaseIds.isEmpty()) {
            Table<Record> knowledgeBases = table(name("knowledge_bases"));
            Field<UUID> knowledgeBaseId = field(name("knowledge_bases", "id"), UUID.class);
            int found = dsl.fetchCount(
                    knowledgeBases,
                    field(name("knowledge_bases", "workspace_id"), UUID.class)
                            .eq(workspaceId)
                            .and(knowledgeBaseId.in(knowledgeBaseIds))
                            .and(field(name("knowledge_bases", "archived_at"), OffsetDateTime.class).isNull()));
            if (found != knowledgeBaseIds.size()) {
                throw new IllegalArgumentException(
                        "Every invitation knowledge base must belong to the target workspace");
            }
        }
    }

    void grantTargets(InvitationRecord invitation, UUID userId, OffsetDateTime now) {
        Table<Record> teamMembers = table(name("team_members"));
        Field<UUID> teamMemberTeamId = field(name("team_id"), UUID.class);
        Field<UUID> teamMemberUserId = field(name("user_id"), UUID.class);
        for (UUID teamId : invitation.targetTeamIds()) {
            if (!activeTeamInWorkspace(invitation.workspaceId(), teamId)) {
                continue;
            }
            dsl.insertInto(teamMembers)
                    .columns(
                            teamMemberTeamId,
                            teamMemberUserId,
                            field(name("role"), String.class),
                            CREATED_AT,
                            UPDATED_AT)
                    .values(teamId, userId, "MEMBER", now, now)
                    .onConflict(teamMemberTeamId, teamMemberUserId)
                    .doNothing()
                    .execute();
        }

        Table<Record> members = table(name("knowledge_base_members"));
        Field<UUID> memberKnowledgeBaseId = field(name("knowledge_base_id"), UUID.class);
        Field<UUID> memberUserId = field(name("user_id"), UUID.class);
        Field<String> memberRole = field(name("role"), String.class);
        for (InvitationKnowledgeBaseTarget target : invitation.targetKnowledgeBaseRoles()) {
            if (!activeKnowledgeBaseInWorkspace(
                    invitation.workspaceId(), target.knowledgeBaseId())) {
                continue;
            }
            String currentRole = dsl.select(memberRole)
                    .from(members)
                    .where(memberKnowledgeBaseId
                            .eq(target.knowledgeBaseId())
                            .and(memberUserId.eq(userId)))
                    .forUpdate()
                    .fetchOne(memberRole);
            if (currentRole == null) {
                dsl.insertInto(members)
                        .columns(
                                memberKnowledgeBaseId,
                                memberUserId,
                                memberRole,
                                CREATED_AT,
                                UPDATED_AT)
                        .values(target.knowledgeBaseId(), userId, target.role(), now, now)
                        .execute();
            } else if (roleRank(target.role()) > roleRank(currentRole)) {
                dsl.update(members)
                        .set(memberRole, target.role())
                        .set(UPDATED_AT, now)
                        .where(memberKnowledgeBaseId
                                .eq(target.knowledgeBaseId())
                                .and(memberUserId.eq(userId)))
                        .execute();
            }
        }
    }

    void markAccepted(UUID invitationId, UUID userId, OffsetDateTime now) {
        int updated = dsl.update(INVITATIONS)
                .set(STATUS, "ACCEPTED")
                .set(ACCEPTED_AT, now)
                .set(ACCEPTED_BY, userId)
                .set(DELIVERY_TOKEN_ENCRYPTED, (String) null)
                .set(UPDATED_AT, now)
                .where(ID.eq(invitationId).and(STATUS.in("QUEUED", "SENT", "FAILED")))
                .execute();
        requireUpdated(updated);
    }

    void markExpired(UUID invitationId, OffsetDateTime now) {
        dsl.update(INVITATIONS)
                .set(STATUS, "EXPIRED")
                .set(DELIVERY_TOKEN_ENCRYPTED, (String) null)
                .set(UPDATED_AT, now)
                .where(ID.eq(invitationId).and(STATUS.in("QUEUED", "SENT", "FAILED")))
                .execute();
    }

    void markRevoked(UUID invitationId, OffsetDateTime now) {
        int updated = dsl.update(INVITATIONS)
                .set(STATUS, "REVOKED")
                .set(REVOKED_AT, now)
                .set(DELIVERY_TOKEN_ENCRYPTED, (String) null)
                .set(UPDATED_AT, now)
                .where(ID.eq(invitationId).and(STATUS.in("QUEUED", "SENT", "FAILED")))
                .execute();
        requireUpdated(updated);
    }

    void requeue(
            UUID invitationId,
            String tokenHash,
            String deliveryTokenEncrypted,
            long smtpSettingsVersion,
            OffsetDateTime now) {
        int updated = dsl.update(INVITATIONS)
                .set(STATUS, "QUEUED")
                .set(TOKEN_HASH, tokenHash)
                .set(DELIVERY_TOKEN_ENCRYPTED, deliveryTokenEncrypted)
                .set(SMTP_SETTINGS_VERSION, smtpSettingsVersion)
                .set(SENT_AT, (OffsetDateTime) null)
                .set(LAST_DELIVERY_ERROR, (String) null)
                .set(UPDATED_AT, now)
                .where(ID.eq(invitationId).and(STATUS.in("QUEUED", "SENT", "FAILED")))
                .execute();
        requireUpdated(updated);
    }

    private org.jooq.SelectConditionStep<? extends Record> selectInvitation() {
        return dsl.select(
                        ID,
                        WORKSPACE_ID,
                        WORKSPACE_NAME,
                        EMAIL_ORIGINAL,
                        EMAIL_NORMALIZED,
                        TOKEN_HASH,
                        DELIVERY_TOKEN_ENCRYPTED,
                        WORKSPACE_ROLE,
                        TARGET_TEAM_IDS,
                        TARGET_KNOWLEDGE_BASE_ROLES,
                        STATUS,
                        SMTP_SETTINGS_VERSION,
                        EXPIRES_AT,
                        SENT_AT)
                .from(INVITATIONS)
                .where(field("true", Boolean.class));
    }

    private InvitationRecord map(Record record) {
        return new InvitationRecord(
                record.get(ID),
                record.get(WORKSPACE_ID),
                record.get(WORKSPACE_NAME),
                record.get(EMAIL_ORIGINAL),
                record.get(EMAIL_NORMALIZED),
                record.get(TOKEN_HASH),
                record.get(DELIVERY_TOKEN_ENCRYPTED),
                record.get(WORKSPACE_ROLE),
                teamIds(record.get(TARGET_TEAM_IDS)),
                knowledgeBaseTargets(record.get(TARGET_KNOWLEDGE_BASE_ROLES)),
                record.get(STATUS),
                record.get(SMTP_SETTINGS_VERSION),
                record.get(EXPIRES_AT),
                record.get(SENT_AT));
    }

    private boolean activeTeamInWorkspace(UUID workspaceId, UUID teamId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("teams")))
                .where(field(name("teams", "id"), UUID.class)
                        .eq(teamId)
                        .and(field(name("teams", "workspace_id"), UUID.class).eq(workspaceId))
                        .and(field(name("teams", "deleted_at"), OffsetDateTime.class).isNull())));
    }

    private boolean activeKnowledgeBaseInWorkspace(UUID workspaceId, UUID knowledgeBaseId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(table(name("knowledge_bases")))
                .where(field(name("knowledge_bases", "id"), UUID.class)
                        .eq(knowledgeBaseId)
                        .and(field(name("knowledge_bases", "workspace_id"), UUID.class)
                                .eq(workspaceId))
                        .and(field(name("knowledge_bases", "archived_at"), OffsetDateTime.class)
                                .isNull())));
    }

    private List<UUID> teamIds(JSONB value) {
        JsonNode root = objectMapper.readTree(value == null ? "[]" : value.data());
        List<UUID> result = new ArrayList<>();
        root.forEach(node -> result.add(UUID.fromString(node.stringValue())));
        return List.copyOf(result);
    }

    private List<InvitationKnowledgeBaseTarget> knowledgeBaseTargets(JSONB value) {
        JsonNode root = objectMapper.readTree(value == null ? "[]" : value.data());
        List<InvitationKnowledgeBaseTarget> result = new ArrayList<>();
        root.forEach(node -> result.add(new InvitationKnowledgeBaseTarget(
                UUID.fromString(node.path("knowledgeBaseId").stringValue()),
                node.path("role").stringValue())));
        return List.copyOf(result);
    }

    private static int roleRank(String role) {
        return switch (role) {
            case "MANAGER" -> 3;
            case "EDITOR" -> 2;
            case "READER" -> 1;
            default -> 0;
        };
    }

    private static void requireUpdated(int updated) {
        if (updated != 1) {
            throw new InvitationInvalidException();
        }
    }
}
