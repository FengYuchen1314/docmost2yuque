package io.knowledge.platform.page;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.engagement.ActivityService;
import io.knowledge.platform.search.SearchIndexWriter;
import java.text.Normalizer;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PageLabelService {

    private static final int MAX_LABELS = 20;
    private static final Pattern COLOR = Pattern.compile("#[0-9A-Fa-f]{6}");
    private static final String DEFAULT_COLOR = "#5A8F6B";
    private final PageRepository repository;
    private final AuthorizationService authorization;
    private final SearchIndexWriter searchIndex;
    private final AuditService audit;
    private final ActivityService activity;
    private final Clock clock;

    public PageLabelService(
            PageRepository repository,
            AuthorizationService authorization,
            SearchIndexWriter searchIndex,
            AuditService audit,
            ActivityService activity,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.searchIndex = searchIndex;
        this.audit = audit;
        this.activity = activity;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PageLabelsView labels(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        requireActive(pageId);
        return snapshot(pageId);
    }

    @Transactional
    public PageLabelsView update(
            UUID actorId,
            UUID pageId,
            long expectedRevision,
            List<PageLabelInput> requested) {
        if (pageId == null || expectedRevision < 0) {
            throw new IllegalArgumentException("Page id and label revision are required");
        }
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.EDIT);
        PageView page = requireActive(pageId);
        List<NormalizedPageLabel> labels = normalize(requested);
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (!repository.replaceLabels(
                pageId, page.workspaceId(), expectedRevision, labels, actorId, now)) {
            throw new DomainConflictException(
                    "PAGE_LABEL_REVISION_CONFLICT",
                    "Page labels changed since they were loaded; reload and apply the edit again");
        }
        List<String> names = labels.stream().map(NormalizedPageLabel::name).toList();
        searchIndex.updateLabels(page.workspaceId(), "PAGE", pageId, names, now);
        audit.success(page.workspaceId(), actorId, "page.labels.update", "PAGE", pageId);
        activity.recordPageMutation(page.workspaceId(), actorId, pageId, "EDIT");
        return snapshot(pageId);
    }

    @Transactional(readOnly = true)
    public List<String> namesForIndex(UUID pageId) {
        return repository.labels(pageId).stream().map(PageLabelView::name).toList();
    }

    private PageLabelsView snapshot(UUID pageId) {
        return new PageLabelsView(
                pageId, repository.labelRevision(pageId), List.copyOf(repository.labels(pageId)));
    }

    private PageView requireActive(UUID pageId) {
        PageView page = repository.findActive(pageId);
        if (page == null) throw new ResourceNotFoundException();
        return page;
    }

    private static List<NormalizedPageLabel> normalize(List<PageLabelInput> requested) {
        if (requested == null) return List.of();
        if (requested.size() > MAX_LABELS) {
            throw new IllegalArgumentException("A page can have at most 20 labels");
        }
        List<NormalizedPageLabel> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (PageLabelInput input : requested) {
            if (input == null || input.name() == null) {
                throw new IllegalArgumentException("Page label name is required");
            }
            String name = Normalizer.normalize(input.name(), Normalizer.Form.NFKC).trim();
            if (name.isEmpty()
                    || name.length() > 50
                    || name.codePoints().anyMatch(Character::isISOControl)) {
                throw new IllegalArgumentException("Page label name is invalid");
            }
            String normalized = name.toLowerCase(Locale.ROOT);
            if (!seen.add(normalized)) {
                throw new IllegalArgumentException("Page labels must be unique");
            }
            String color = input.color() == null || input.color().isBlank()
                    ? DEFAULT_COLOR
                    : input.color().trim().toUpperCase(Locale.ROOT);
            if (!COLOR.matcher(color).matches()) {
                throw new IllegalArgumentException("Page label color is invalid");
            }
            result.add(new NormalizedPageLabel(name, normalized, color));
        }
        return List.copyOf(result);
    }
}
