package io.knowledge.platform.invitation;

import tools.jackson.databind.ObjectMapper;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.common.EmailAddress;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.common.SecretCipher;
import io.knowledge.platform.identity.AuthenticatedIdentity;
import io.knowledge.platform.identity.IdentityInvitationProvisioning;
import io.knowledge.platform.jobs.JobQueue;
import io.knowledge.platform.mail.SmtpSettingsService;
import io.knowledge.platform.workspace.WorkspaceProvisioning;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.HexFormat;
import java.util.Set;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InvitationService {

    private static final String SEND_JOB_TYPE = "invitation.send";
    private static final Set<String> INVITABLE_ROLES =
            Set.of("ADMIN", "MEMBER", "EXTERNAL");
    private static final Set<String> KNOWLEDGE_BASE_ROLES =
            Set.of("MANAGER", "EDITOR", "READER");

    private final InvitationRepository repository;
    private final IdentityInvitationProvisioning identityProvisioning;
    private final WorkspaceProvisioning workspaceProvisioning;
    private final AuthorizationService authorization;
    private final SmtpSettingsService smtpSettingsService;
    private final SecretCipher secretCipher;
    private final JobQueue jobQueue;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    InvitationService(
            InvitationRepository repository,
            IdentityInvitationProvisioning identityProvisioning,
            WorkspaceProvisioning workspaceProvisioning,
            AuthorizationService authorization,
            SmtpSettingsService smtpSettingsService,
            SecretCipher secretCipher,
            JobQueue jobQueue,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.identityProvisioning = identityProvisioning;
        this.workspaceProvisioning = workspaceProvisioning;
        this.authorization = authorization;
        this.smtpSettingsService = smtpSettingsService;
        this.secretCipher = secretCipher;
        this.jobQueue = jobQueue;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public InvitationView create(CreateInvitationCommand command) {
        if (command.workspaceId() == null || command.createdBy() == null) {
            throw new IllegalArgumentException("workspaceId and createdBy are required");
        }
        if (!INVITABLE_ROLES.contains(command.workspaceRole())) {
            throw new IllegalArgumentException("Invitation workspace role is invalid");
        }
        if (command.expiresInHours() < 1 || command.expiresInHours() > 720) {
            throw new IllegalArgumentException("Invitation expiration must be between 1 and 720 hours");
        }
        workspaceProvisioning.requireInvitableWorkspace(command.workspaceId());
        List<UUID> targetTeamIds = targetTeamIds(command.targetTeamIds());
        List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles =
                targetKnowledgeBaseRoles(command.targetKnowledgeBaseRoles());
        repository.requireTargetsInWorkspace(
                command.workspaceId(), targetTeamIds, targetKnowledgeBaseRoles);
        long smtpSettingsVersion = smtpSettingsService.requireReadyConfigurationVersion();
        EmailAddress email = EmailAddress.parse(command.email());
        OffsetDateTime now = OffsetDateTime.now(clock);
        UUID invitationId = Ids.next();
        String token = generateToken();
        String tokenHash = hashToken(token);
        OffsetDateTime expiresAt = now.plusHours(command.expiresInHours());

        repository.revokeActive(command.workspaceId(), email.normalized(), now);
        repository.insert(
                invitationId,
                command.workspaceId(),
                email.original(),
                email.normalized(),
                tokenHash,
                secretCipher.encrypt("invitation.token", token),
                command.workspaceRole(),
                targetTeamIds,
                targetKnowledgeBaseRoles,
                smtpSettingsVersion,
                expiresAt,
                command.createdBy(),
                now);
        enqueueSend(invitationId, smtpSettingsVersion, tokenHash, now);
        return new InvitationView(
                invitationId,
                command.workspaceId(),
                email.normalized(),
                command.workspaceRole(),
                targetTeamIds,
                targetKnowledgeBaseRoles,
                "QUEUED",
                expiresAt,
                null);
    }

    @Transactional(readOnly = true)
    public List<InvitationView> list(UUID workspaceId, int limit) {
        if (workspaceId == null) {
            throw new IllegalArgumentException("workspaceId is required");
        }
        return repository.list(workspaceId, Math.max(1, Math.min(limit, 200)), 0);
    }

    @Transactional(readOnly = true)
    public InvitationPageView page(UUID workspaceId, int limit, int offset) {
        if (workspaceId == null) {
            throw new IllegalArgumentException("workspaceId is required");
        }
        int count = Math.max(1, Math.min(limit, 50));
        int start = Math.max(0, Math.min(offset, 1_000_000));
        List<InvitationView> rows = repository.list(workspaceId, count + 1, start);
        boolean hasMore = rows.size() > count;
        List<InvitationView> items = List.copyOf(
                rows.subList(0, Math.min(rows.size(), count)));
        return new InvitationPageView(items, start + items.size(), hasMore);
    }

    @Transactional
    public ResolvedInvitation resolve(String token) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        InvitationRecord invitation = requireActive(repository.findByTokenHashForUpdate(hashToken(token)), now);
        return new ResolvedInvitation(
                invitation.id(),
                invitation.workspaceId(),
                invitation.workspaceName(),
                maskEmail(invitation.emailNormalized()),
                invitation.workspaceRole(),
                invitation.targetTeamIds(),
                invitation.targetKnowledgeBaseRoles(),
                identityProvisioning.activeIdentityExists(invitation.emailNormalized()),
                invitation.expiresAt());
    }

    @Transactional
    public AcceptedInvitation accept(
            String token,
            String password,
            String passwordConfirmation) {
        if (password != null || passwordConfirmation != null) {
            if (password == null || !password.equals(passwordConfirmation)) {
                throw new IllegalArgumentException("Password confirmation does not match");
            }
        }
        OffsetDateTime now = OffsetDateTime.now(clock);
        InvitationRecord invitation = requireActive(repository.findByTokenHashForUpdate(hashToken(token)), now);
        AuthenticatedIdentity identity = identityProvisioning.findOrCreateInvitedIdentity(
                invitation.emailNormalized(), password);
        workspaceProvisioning.provisionPersonalWorkspace(identity.userId());
        workspaceProvisioning.addMember(
                invitation.workspaceId(), identity.userId(), invitation.workspaceRole());
        repository.grantTargets(invitation, identity.userId(), now);
        authorization.invalidateWorkspace(invitation.workspaceId());
        repository.markAccepted(invitation.id(), identity.userId(), now);
        return new AcceptedInvitation(invitation.id(), invitation.workspaceId(), identity);
    }

    @Transactional
    public InvitationView resend(UUID invitationId) {
        InvitationRecord invitation =
                requireActive(repository.findByIdForUpdate(invitationId), OffsetDateTime.now(clock));
        long smtpSettingsVersion = smtpSettingsService.requireReadyConfigurationVersion();
        OffsetDateTime now = OffsetDateTime.now(clock);
        String token = generateToken();
        String tokenHash = hashToken(token);
        repository.requeue(
                invitationId,
                tokenHash,
                secretCipher.encrypt("invitation.token", token),
                smtpSettingsVersion,
                now);
        enqueueSend(invitationId, smtpSettingsVersion, tokenHash, now);
        return new InvitationView(
                invitation.id(),
                invitation.workspaceId(),
                invitation.emailNormalized(),
                invitation.workspaceRole(),
                invitation.targetTeamIds(),
                invitation.targetKnowledgeBaseRoles(),
                "QUEUED",
                invitation.expiresAt(),
                null);
    }

    @Transactional
    public void revoke(UUID invitationId) {
        InvitationRecord invitation = repository.findByIdForUpdate(invitationId);
        if (invitation == null) {
            throw new InvitationInvalidException();
        }
        repository.markRevoked(invitationId, OffsetDateTime.now(clock));
    }

    private InvitationRecord requireActive(
            InvitationRecord invitation,
            OffsetDateTime now) {
        if (invitation == null
                || !Set.of("QUEUED", "SENT", "FAILED").contains(invitation.status())) {
            throw new InvitationInvalidException();
        }
        if (!invitation.expiresAt().isAfter(now)) {
            repository.markExpired(invitation.id(), now);
            throw new InvitationInvalidException();
        }
        return invitation;
    }

    private void enqueueSend(
            UUID invitationId,
            long smtpSettingsVersion,
            String tokenHash,
            OffsetDateTime now) {
        InvitationSendPayload payload =
                new InvitationSendPayload(invitationId, smtpSettingsVersion, tokenHash);
        jobQueue.enqueue(
                SEND_JOB_TYPE,
                "invitation-send:" + invitationId + ":" + UUID.randomUUID(),
                objectMapper.valueToTree(payload),
                now,
                8);
    }

    private String generateToken() {
        byte[] token = new byte[32];
        secureRandom.nextBytes(token);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(token);
    }

    private static List<UUID> targetTeamIds(List<UUID> values) {
        List<UUID> targets = values == null ? List.of() : List.copyOf(values);
        if (targets.size() > 50 || targets.stream().anyMatch(java.util.Objects::isNull)) {
            throw new IllegalArgumentException("Invitation team targets are invalid");
        }
        if (new LinkedHashSet<>(targets).size() != targets.size()) {
            throw new IllegalArgumentException("Invitation team targets must be unique");
        }
        return targets;
    }

    private static List<InvitationKnowledgeBaseTarget> targetKnowledgeBaseRoles(
            List<InvitationKnowledgeBaseTarget> values) {
        List<InvitationKnowledgeBaseTarget> targets = values == null ? List.of() : List.copyOf(values);
        if (targets.size() > 100) {
            throw new IllegalArgumentException("Too many knowledge base targets");
        }
        Set<UUID> ids = new LinkedHashSet<>();
        List<InvitationKnowledgeBaseTarget> normalized = targets.stream().map(value -> {
            if (value == null || value.knowledgeBaseId() == null || value.role() == null) {
                throw new IllegalArgumentException("Invitation knowledge base target is invalid");
            }
            String role = value.role().toUpperCase(Locale.ROOT);
            if (!KNOWLEDGE_BASE_ROLES.contains(role)) {
                throw new IllegalArgumentException("Invitation knowledge base role is invalid");
            }
            if (!ids.add(value.knowledgeBaseId())) {
                throw new IllegalArgumentException("Invitation knowledge base targets must be unique");
            }
            return new InvitationKnowledgeBaseTarget(value.knowledgeBaseId(), role);
        }).toList();
        return List.copyOf(normalized);
    }

    static String hashToken(String token) {
        if (token == null || token.length() < 32 || token.length() > 256) {
            throw new InvitationInvalidException();
        }
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }

    private static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 0) {
            return "***";
        }
        String local = email.substring(0, at);
        String visible = local.substring(0, 1);
        return visible + "***" + email.substring(at);
    }
}
