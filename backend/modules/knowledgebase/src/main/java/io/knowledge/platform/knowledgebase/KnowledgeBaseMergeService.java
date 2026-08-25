package io.knowledge.platform.knowledgebase;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class KnowledgeBaseMergeService {

    private static final BigInteger MAX_RANK = BigInteger.TEN.pow(39).subtract(BigInteger.ONE);
    private final KnowledgeBaseMergeRepository repository;
    private final AuthorizationService authorization;
    private final AuditService auditService;
    private final Clock clock;

    public KnowledgeBaseMergeService(
            KnowledgeBaseMergeRepository repository,
            AuthorizationService authorization,
            AuditService auditService,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.auditService = auditService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public KnowledgeBaseMergePlan plan(
            UUID actorId,
            UUID sourceKnowledgeBaseId,
            UUID targetKnowledgeBaseId) {
        validateIds(sourceKnowledgeBaseId, targetKnowledgeBaseId);
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, sourceKnowledgeBaseId, Capability.MANAGE);
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, targetKnowledgeBaseId, Capability.MANAGE);
        Map<UUID, KnowledgeBaseMergeRepository.MergeKnowledgeBase> values = byId(
                repository.pair(sourceKnowledgeBaseId, targetKnowledgeBaseId));
        KnowledgeBaseMergeRepository.MergeKnowledgeBase source = active(
                values.get(sourceKnowledgeBaseId));
        KnowledgeBaseMergeRepository.MergeKnowledgeBase target = active(
                values.get(targetKnowledgeBaseId));
        requireSameWorkspace(source, target);
        return buildPlan(source, target);
    }

    @Transactional
    public KnowledgeBaseMergeResult execute(
            UUID actorId,
            UUID sourceKnowledgeBaseId,
            UUID targetKnowledgeBaseId,
            String planFingerprint,
            String idempotencyKey) {
        validateIds(sourceKnowledgeBaseId, targetKnowledgeBaseId);
        String key = idempotencyKey(idempotencyKey);
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, targetKnowledgeBaseId, Capability.MANAGE);
        KnowledgeBaseMergeResult replay = repository.completed(
                targetKnowledgeBaseId, actorId, key);
        if (replay != null) return replay(replay, sourceKnowledgeBaseId);

        Map<UUID, KnowledgeBaseMergeRepository.MergeKnowledgeBase> values = byId(
                repository.lockPair(sourceKnowledgeBaseId, targetKnowledgeBaseId));
        KnowledgeBaseMergeRepository.MergeKnowledgeBase source = values.get(sourceKnowledgeBaseId);
        KnowledgeBaseMergeRepository.MergeKnowledgeBase target = values.get(targetKnowledgeBaseId);
        if (source == null || target == null) throw new ResourceNotFoundException();
        replay = repository.completed(targetKnowledgeBaseId, actorId, key);
        if (replay != null) return replay(replay, sourceKnowledgeBaseId);
        if (source.archivedAt() != null) {
            throw new DomainConflictException(
                    "KNOWLEDGE_BASE_ALREADY_MERGED",
                    "The source knowledge base is already archived or merged");
        }
        if (target.archivedAt() != null) throw new ResourceNotFoundException();
        requireSameWorkspace(source, target);
        authorization.require(
                actorId, ResourceType.KNOWLEDGE_BASE, sourceKnowledgeBaseId, Capability.DELETE);
        KnowledgeBaseMergePlan current = buildPlan(source, target);
        if (planFingerprint == null || !current.fingerprint().equals(planFingerprint)) {
            throw new DomainConflictException(
                    "KNOWLEDGE_BASE_MERGE_PLAN_STALE",
                    "The knowledge bases changed after the merge preview; generate a new plan");
        }
        String position = nextRootPosition(repository.lastRootPosition(target.id()));
        OffsetDateTime now = OffsetDateTime.now(clock);
        KnowledgeBaseMergeRepository.MergeMutation mutation = repository.apply(
                source, target, current.paths(), Ids.next(), position, actorId, now);
        KnowledgeBaseMergeResult result = new KnowledgeBaseMergeResult(
                Ids.next(), source.id(), target.id(), mutation.movedPages(),
                mutation.movedCatalogNodes(), mutation.mergedMembers(), mutation.revokedShares(),
                mutation.catalogRevision(), current.paths(), current.warnings(), now, false);
        repository.save(result, source.workspaceId(), current.fingerprint(), key, actorId);
        authorization.invalidateWorkspace(source.workspaceId());
        auditService.success(
                source.workspaceId(), actorId, "knowledge-base.merge", "KNOWLEDGE_BASE", target.id());
        return result;
    }

    private KnowledgeBaseMergePlan buildPlan(
            KnowledgeBaseMergeRepository.MergeKnowledgeBase source,
            KnowledgeBaseMergeRepository.MergeKnowledgeBase target) {
        List<KnowledgeBaseMergeRepository.MergePage> sourcePages = repository.pages(source.id());
        Set<String> targetPaths = new HashSet<>();
        repository.paths(target.id()).forEach(path -> targetPaths.add(path.toLowerCase(Locale.ROOT)));
        Set<String> reserved = new HashSet<>(targetPaths);
        sourcePages.forEach(page -> reserved.add(page.path().toLowerCase(Locale.ROOT)));
        List<KnowledgeBaseMergePath> paths = new ArrayList<>();
        for (KnowledgeBaseMergeRepository.MergePage page : sourcePages) {
            boolean conflict = targetPaths.contains(page.path().toLowerCase(Locale.ROOT));
            String resolved = conflict
                    ? resolvePath(page.path(), source.slug(), reserved)
                    : page.path();
            reserved.add(resolved.toLowerCase(Locale.ROOT));
            paths.add(new KnowledgeBaseMergePath(
                    page.id(), page.title(), page.path(), resolved, conflict));
        }
        KnowledgeBaseMergeRepository.MergeCounts counts = repository.counts(source.id());
        List<String> warnings = new ArrayList<>();
        warnings.add("目标知识库的名称、外观、公开范围、发布方式和首页设置保持不变");
        warnings.add("文稿、发布版本和文稿分享链接保留原 ID；源知识库完成后归档");
        if (counts.catalogNodes() > 0) {
            warnings.add("源目录会作为“来自「" + source.name() + "」”分组整体并入目标目录");
        }
        if (counts.shares() > 0) {
            warnings.add("源知识库级分享链接会撤销；文稿级分享链接不受影响");
        }
        if (paths.stream().anyMatch(KnowledgeBaseMergePath::renamed)) {
            warnings.add("存在访问路径冲突，冲突文稿会使用预检报告中的新路径");
        }
        String fingerprint = fingerprint(source, target, sourcePages, repository.paths(target.id()), counts, paths);
        return new KnowledgeBaseMergePlan(
                source.id(), source.name(), target.id(), target.name(), sourcePages.size(),
                counts.activePages(), counts.catalogNodes(), counts.publications(), counts.members(),
                counts.shares(), List.copyOf(paths), List.copyOf(warnings), fingerprint);
    }

    private static String resolvePath(String original, String sourceSlug, Set<String> reserved) {
        String suffix = sourceSlug == null || sourceSlug.isBlank() ? "merged" : sourceSlug;
        for (int attempt = 1; attempt <= 10_000; attempt++) {
            String ending = "-" + suffix + (attempt == 1 ? "" : "-" + attempt);
            int available = Math.max(1, 180 - ending.length());
            String base = original.substring(0, Math.min(original.length(), available))
                    .replaceAll("[-_]+$", "");
            if (base.isBlank()) base = "page";
            String candidate = base + ending;
            if (!reserved.contains(candidate.toLowerCase(Locale.ROOT))) return candidate;
        }
        throw new DomainConflictException(
                "KNOWLEDGE_BASE_PATH_EXHAUSTED",
                "A unique path could not be allocated for the merged page");
    }

    private static String fingerprint(
            KnowledgeBaseMergeRepository.MergeKnowledgeBase source,
            KnowledgeBaseMergeRepository.MergeKnowledgeBase target,
            List<KnowledgeBaseMergeRepository.MergePage> sourcePages,
            List<String> targetPaths,
            KnowledgeBaseMergeRepository.MergeCounts counts,
            List<KnowledgeBaseMergePath> mappings) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            StringBuilder value = new StringBuilder()
                    .append(source.id()).append('|').append(source.updatedAt()).append('|')
                    .append(source.catalogRevision()).append('|').append(target.id()).append('|')
                    .append(target.updatedAt()).append('|').append(target.catalogRevision()).append('|')
                    .append(counts);
            sourcePages.forEach(page -> value.append('|').append(page.id()).append(':')
                    .append(page.path()).append(':').append(page.updatedAt()).append(':')
                    .append(page.deletedAt()));
            targetPaths.stream().sorted().forEach(path -> value.append("|target:").append(path));
            mappings.forEach(path -> value.append("|map:").append(path.pageId()).append(':')
                    .append(path.resolvedPath()));
            return HexFormat.of().formatHex(digest.digest(
                    value.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String nextRootPosition(String lower) {
        BigInteger low = lower == null ? BigInteger.ZERO : new BigInteger(lower);
        if (MAX_RANK.subtract(low).compareTo(BigInteger.ONE) <= 0) {
            throw new DomainConflictException(
                    "CATALOG_RANK_EXHAUSTED",
                    "The target catalog must be rebalanced before merging");
        }
        String value = low.add(MAX_RANK).divide(BigInteger.TWO).toString();
        return "0".repeat(39 - value.length()) + value;
    }

    private static KnowledgeBaseMergeResult replay(
            KnowledgeBaseMergeResult value,
            UUID requestedSourceId) {
        if (!value.sourceKnowledgeBaseId().equals(requestedSourceId)) {
            throw new DomainConflictException(
                    "IDEMPOTENCY_KEY_REUSED",
                    "The idempotency key was already used for another merge");
        }
        return new KnowledgeBaseMergeResult(
                value.mergeId(), value.sourceKnowledgeBaseId(), value.targetKnowledgeBaseId(),
                value.movedPages(), value.movedCatalogNodes(), value.mergedMembers(),
                value.revokedKnowledgeBaseShares(), value.targetCatalogRevision(), value.paths(),
                value.warnings(), value.completedAt(), true);
    }

    private static Map<UUID, KnowledgeBaseMergeRepository.MergeKnowledgeBase> byId(
            List<KnowledgeBaseMergeRepository.MergeKnowledgeBase> values) {
        Map<UUID, KnowledgeBaseMergeRepository.MergeKnowledgeBase> result = new LinkedHashMap<>();
        values.forEach(value -> result.put(value.id(), value));
        return result;
    }

    private static KnowledgeBaseMergeRepository.MergeKnowledgeBase active(
            KnowledgeBaseMergeRepository.MergeKnowledgeBase value) {
        if (value == null || value.archivedAt() != null) throw new ResourceNotFoundException();
        return value;
    }

    private static void requireSameWorkspace(
            KnowledgeBaseMergeRepository.MergeKnowledgeBase source,
            KnowledgeBaseMergeRepository.MergeKnowledgeBase target) {
        if (!source.workspaceId().equals(target.workspaceId())) {
            throw new IllegalArgumentException("Knowledge bases must belong to the same workspace");
        }
    }

    private static void validateIds(UUID source, UUID target) {
        if (source == null || target == null || source.equals(target)) {
            throw new IllegalArgumentException("Source and target knowledge bases must be distinct");
        }
    }

    private static String idempotencyKey(String value) {
        if (value == null || value.trim().length() < 8 || value.trim().length() > 200) {
            throw new IllegalArgumentException("Merge idempotency key must contain 8 to 200 characters");
        }
        return value.trim();
    }
}
