package io.knowledge.platform.page;

import io.knowledge.platform.attachment.AttachmentReferenceValidator;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.engagement.NotificationService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class ContentCardService {

    private final ContentCardRegistry registry;
    private final ContentCardExtractor extractor;
    private final ContentCardRepository repository;
    private final AuthorizationService authorization;
    private final AttachmentReferenceValidator attachmentReferences;
    private final NotificationService notifications;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public ContentCardService(
            ContentCardRegistry registry,
            ContentCardExtractor extractor,
            ContentCardRepository repository,
            AuthorizationService authorization,
            AttachmentReferenceValidator attachmentReferences,
            NotificationService notifications,
            ObjectMapper objectMapper,
            Clock clock) {
        this.registry = registry;
        this.extractor = extractor;
        this.repository = repository;
        this.authorization = authorization;
        this.attachmentReferences = attachmentReferences;
        this.notifications = notifications;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    void synchronize(
            UUID actorId,
            PageView page,
            JsonNode content,
            boolean strict) {
        List<ExtractedContentCard> extracted;
        try {
            extracted = extractor.extract(content);
            Set<UUID> instanceIds = new HashSet<>();
            for (ExtractedContentCard card : extracted) {
                if (!instanceIds.add(card.instanceId())) {
                    throw new DomainConflictException(
                            "CARD_INSTANCE_DUPLICATE",
                            "A content card instance may appear only once on a page");
                }
            }
        } catch (IllegalArgumentException | DomainConflictException exception) {
            if (strict) {
                throw exception;
            }
            repository.synchronize(page, actorId, List.of(), OffsetDateTime.now(clock));
            return;
        }
        List<ExtractedContentCard> supported =
                extracted.stream().filter(ExtractedContentCard::supported).toList();
        List<ExtractedContentCard> newMentions = new ArrayList<>();
        try {
            for (ExtractedContentCard card : supported) {
                for (JsonNode reference : attachmentReferenceNodes(card)) {
                    String attachmentId = reference.path("attachmentId").stringValue(null);
                    if (attachmentId == null) continue;
                    UUID id;
                    try {
                        id = UUID.fromString(attachmentId);
                    } catch (IllegalArgumentException exception) {
                        throw new IllegalArgumentException("Content card attachment id is invalid");
                    }
                    attachmentReferences.requirePageAttachment(page.id(), id);
                    String expectedUrl = "/api/v1/attachments/" + id + "/content";
                    if (!expectedUrl.equals(reference.path("url").stringValue(null))) {
                        throw new IllegalArgumentException("Content card attachment URL is invalid");
                    }
                }
                if ("mention".equals(card.cardId())) {
                    UUID mentionedUserId = UUID.fromString(card.data().path("userId").stringValue());
                    notifications.requireWorkspaceMember(page.workspaceId(), mentionedUserId);
                    if (repository.findActive(card.instanceId()) == null) {
                        newMentions.add(card);
                    }
                }
            }
        } catch (IllegalArgumentException | ResourceNotFoundException exception) {
            if (strict) {
                throw exception;
            }
            repository.synchronize(page, actorId, List.of(), OffsetDateTime.now(clock));
            return;
        }
        repository.synchronize(page, actorId, supported, OffsetDateTime.now(clock));
        for (ExtractedContentCard mention : newMentions) {
            UUID recipientId = UUID.fromString(mention.data().path("userId").stringValue());
            String label = mention.data().path("label").stringValue();
            JsonNode anchor = objectMapper.createObjectNode()
                    .put("cardInstanceId", mention.instanceId().toString())
                    .put("pointer", mention.sourcePointer());
            JsonNode payload = objectMapper.createObjectNode()
                    .put("preview", "@" + label)
                    .put("label", label);
            notifications.notify(
                    recipientId, page.workspaceId(), "PAGE_MENTION", actorId,
                    "PAGE", page.id(), anchor, payload,
                    "page-mention:" + mention.instanceId() + ":" + recipientId);
        }
    }

    private static List<JsonNode> attachmentReferenceNodes(ExtractedContentCard card) {
        if (!"gallery".equals(card.cardId())) return List.of(card.data());
        List<JsonNode> references = new ArrayList<>();
        for (JsonNode item : card.data().path("items")) references.add(item);
        return List.copyOf(references);
    }

    @Transactional(readOnly = true)
    public List<ContentCardDefinitionView> definitions(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        boolean enabled = authorization
                .resolve(actorId, ResourceType.PAGE, pageId)
                .allows(Capability.EDIT);
        return registry.all().stream()
                .map(definition -> definition.view(enabled))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<ContentCardDefinitionView> recent(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        boolean enabled = authorization
                .resolve(actorId, ResourceType.PAGE, pageId)
                .allows(Capability.EDIT);
        List<ContentCardDefinitionView> result = new ArrayList<>();
        for (String cardId : repository.recentCardIds(actorId, 12)) {
            ContentCardDefinition definition = registry.find(cardId);
            if (definition != null) {
                result.add(definition.view(enabled));
            }
        }
        return List.copyOf(result);
    }

    @Transactional
    public void recordUsage(UUID actorId, UUID pageId, String cardId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.EDIT);
        if (registry.find(cardId) == null) {
            throw new IllegalArgumentException("Unknown content card");
        }
        repository.recordUsage(actorId, cardId, OffsetDateTime.now(clock));
    }

    @Transactional(readOnly = true)
    public ContentCardInstanceView instance(UUID actorId, UUID instanceId) {
        ContentCardInstanceView instance = requireInstance(instanceId);
        authorization.require(actorId, ResourceType.PAGE, instance.pageId(), Capability.READ);
        return instance;
    }

    @Transactional
    public PollStateView vote(
            UUID actorId,
            UUID instanceId,
            List<String> requestedOptionIds) {
        ContentCardInstanceView instance = requireCard(instanceId, "poll");
        authorization.require(
                actorId, ResourceType.PAGE, instance.pageId(), Capability.COMMENT);
        PollConfiguration configuration = pollConfiguration(instance.data());
        if (configuration.closed()) {
            throw new DomainConflictException("POLL_CLOSED", "This poll is closed");
        }
        List<String> optionIds = requestedOptionIds == null
                ? List.of()
                : requestedOptionIds.stream().distinct().toList();
        if (optionIds.isEmpty()
                || (!configuration.multiple() && optionIds.size() != 1)
                || optionIds.size() > configuration.options().size()
                || !configuration.options().keySet().containsAll(optionIds)) {
            throw new IllegalArgumentException("Poll selections are invalid");
        }
        repository.upsertVote(instanceId, actorId, optionIds, OffsetDateTime.now(clock));
        return pollState(actorId, instance);
    }

    @Transactional(readOnly = true)
    public PollStateView pollState(UUID actorId, UUID instanceId) {
        ContentCardInstanceView instance = requireCard(instanceId, "poll");
        authorization.require(actorId, ResourceType.PAGE, instance.pageId(), Capability.READ);
        return pollState(actorId, instance);
    }

    @Transactional
    public CheckinStateView checkin(
            UUID actorId,
            UUID instanceId,
            LocalDate requestedDate) {
        ContentCardInstanceView instance = requireCard(instanceId, "checkin");
        authorization.require(
                actorId, ResourceType.PAGE, instance.pageId(), Capability.COMMENT);
        CheckinConfiguration configuration = checkinConfiguration(instance.data());
        LocalDate today = LocalDate.now(clock.withZone(configuration.timezone()));
        LocalDate localDate = requestedDate == null ? today : requestedDate;
        if (localDate.isBefore(configuration.startDate())
                || localDate.isAfter(configuration.endDate())
                || localDate.isAfter(today)) {
            throw new IllegalArgumentException("Check-in date is outside the allowed range");
        }
        repository.checkin(instanceId, actorId, localDate, OffsetDateTime.now(clock));
        return checkinState(actorId, instance, localDate);
    }

    @Transactional(readOnly = true)
    public CheckinStateView checkinState(UUID actorId, UUID instanceId) {
        ContentCardInstanceView instance = requireCard(instanceId, "checkin");
        authorization.require(actorId, ResourceType.PAGE, instance.pageId(), Capability.READ);
        CheckinConfiguration configuration = checkinConfiguration(instance.data());
        LocalDate today = LocalDate.now(clock.withZone(configuration.timezone()));
        return checkinState(actorId, instance, today);
    }

    private PollStateView pollState(UUID actorId, ContentCardInstanceView instance) {
        PollConfiguration configuration = pollConfiguration(instance.data());
        List<ContentCardRepository.PollVote> votes = repository.pollVotes(instance.id());
        Map<String, Long> counts = new LinkedHashMap<>();
        configuration.options().keySet().forEach(id -> counts.put(id, 0L));
        List<String> selected = List.of();
        for (ContentCardRepository.PollVote vote : votes) {
            for (String optionId : vote.optionIds()) {
                counts.computeIfPresent(optionId, (ignored, count) -> count + 1L);
            }
            if (vote.userId().equals(actorId)) {
                selected = vote.optionIds();
            }
        }
        List<PollStateView.OptionResult> options = configuration.options().entrySet().stream()
                .map(entry -> new PollStateView.OptionResult(
                        entry.getKey(), entry.getValue(), counts.get(entry.getKey())))
                .toList();
        return new PollStateView(
                instance.id(),
                votes.size(),
                options,
                selected,
                configuration.closed());
    }

    private CheckinStateView checkinState(
            UUID actorId,
            ContentCardInstanceView instance,
            LocalDate localDate) {
        ContentCardRepository.CheckinCounts counts =
                repository.checkinCounts(instance.id(), actorId, localDate);
        return new CheckinStateView(
                instance.id(),
                localDate,
                counts.participants(),
                counts.today(),
                counts.checked());
    }

    private ContentCardInstanceView requireCard(UUID instanceId, String cardId) {
        ContentCardInstanceView instance = requireInstance(instanceId);
        if (!cardId.equals(instance.cardId())) {
            throw new ResourceNotFoundException();
        }
        return instance;
    }

    private ContentCardInstanceView requireInstance(UUID instanceId) {
        if (instanceId == null) {
            throw new IllegalArgumentException("Content card instance id is required");
        }
        ContentCardInstanceView instance = repository.findActive(instanceId);
        if (instance == null) {
            throw new ResourceNotFoundException();
        }
        return instance;
    }

    private PollConfiguration pollConfiguration(JsonNode data) {
        registry.validate("poll", 1, data);
        LinkedHashMap<String, String> options = new LinkedHashMap<>();
        for (JsonNode option : data.path("options")) {
            options.put(
                    option.path("id").stringValue(),
                    option.path("label").stringValue());
        }
        String closesAt = data.path("closesAt").stringValue(null);
        boolean closed = closesAt != null
                && !OffsetDateTime.parse(closesAt).isAfter(OffsetDateTime.now(clock));
        return new PollConfiguration(
                options,
                data.path("multiple").isBoolean()
                        && data.path("multiple").booleanValue(),
                closed);
    }

    private CheckinConfiguration checkinConfiguration(JsonNode data) {
        registry.validate("checkin", 1, data);
        return new CheckinConfiguration(
                LocalDate.parse(data.path("startDate").stringValue()),
                LocalDate.parse(data.path("endDate").stringValue()),
                ZoneId.of(data.path("timezone").stringValue()));
    }

    private record PollConfiguration(
            LinkedHashMap<String, String> options,
            boolean multiple,
            boolean closed) {}

    private record CheckinConfiguration(
            LocalDate startDate,
            LocalDate endDate,
            ZoneId timezone) {}
}
