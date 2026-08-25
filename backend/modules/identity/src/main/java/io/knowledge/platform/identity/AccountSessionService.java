package io.knowledge.platform.identity;

import io.knowledge.platform.common.Ids;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccountSessionService implements IdentitySessionManagement {

    private static final Duration TOUCH_INTERVAL = Duration.ofMinutes(1);

    private final AccountSessionRepository repository;
    private final Clock clock;

    AccountSessionService(AccountSessionRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    @Transactional
    public boolean touch(
            UUID userId,
            String httpSessionId,
            String userAgent,
            String ipAddress) {
        requireSession(userId, httpSessionId);
        String sessionHash = hash(httpSessionId);
        OffsetDateTime now = OffsetDateTime.now(clock);
        AccountSessionRepository.AccountSessionRecord existing = repository.find(sessionHash);
        if (existing == null) {
            repository.insert(
                    Ids.next(), userId, sessionHash, cleanUserAgent(userAgent),
                    cleanAddress(ipAddress), now);
            existing = repository.find(sessionHash);
        }
        if (existing == null || !userId.equals(existing.userId()) || existing.revokedAt() != null) {
            return false;
        }
        if (existing.lastSeenAt().isBefore(now.minus(TOUCH_INTERVAL))) {
            repository.touch(
                    sessionHash, cleanUserAgent(userAgent), cleanAddress(ipAddress), now);
        }
        return true;
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountSessionView> list(UUID userId, String currentHttpSessionId) {
        requireSession(userId, currentHttpSessionId);
        String currentHash = hash(currentHttpSessionId);
        return repository.listActive(userId).stream()
                .map(row -> new AccountSessionView(
                        row.id(),
                        currentHash.equals(row.sessionHash()),
                        row.userAgent(),
                        row.ipAddress(),
                        row.lastSeenAt(),
                        row.createdAt()))
                .toList();
    }

    @Override
    @Transactional
    public boolean revoke(UUID userId, UUID sessionId, String currentHttpSessionId) {
        requireSession(userId, currentHttpSessionId);
        boolean current = repository.listActive(userId).stream()
                .anyMatch(row -> row.id().equals(sessionId)
                        && row.sessionHash().equals(hash(currentHttpSessionId)));
        if (!repository.revoke(userId, sessionId, "USER_REVOKED", OffsetDateTime.now(clock))) {
            throw new IllegalArgumentException("Active login session was not found");
        }
        return current;
    }

    @Override
    @Transactional
    public void revokeOthers(UUID userId, String currentHttpSessionId) {
        requireSession(userId, currentHttpSessionId);
        repository.revokeOthers(
                userId, hash(currentHttpSessionId), "REVOKE_OTHERS", OffsetDateTime.now(clock));
    }

    @Override
    @Transactional
    public void revokeAll(UUID userId) {
        if (userId == null) throw new IllegalArgumentException("User id is required");
        repository.revokeAll(userId, "REVOKE_ALL", OffsetDateTime.now(clock));
    }

    @Override
    @Transactional
    public void revokeHttpSession(String httpSessionId, String reason) {
        if (httpSessionId == null || httpSessionId.isBlank()) return;
        repository.revokeHttpSession(
                hash(httpSessionId), normalizeReason(reason), OffsetDateTime.now(clock));
    }

    private static void requireSession(UUID userId, String httpSessionId) {
        if (userId == null || httpSessionId == null || httpSessionId.isBlank()) {
            throw new IllegalArgumentException("Authenticated HTTP session is required");
        }
    }

    private static String cleanUserAgent(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) return "Unknown client";
        String value = userAgent.trim();
        return value.length() > 1000 ? value.substring(0, 1000) : value;
    }

    private static String cleanAddress(String ipAddress) {
        if (ipAddress == null || ipAddress.isBlank()) return "unknown";
        String value = ipAddress.trim();
        return value.length() > 64 ? value.substring(0, 64) : value;
    }

    private static String normalizeReason(String reason) {
        if (reason == null || reason.isBlank()) return "LOGOUT";
        String value = reason.trim().toUpperCase(java.util.Locale.ROOT);
        return value.length() > 40 ? value.substring(0, 40) : value;
    }

    private static String hash(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }
}
