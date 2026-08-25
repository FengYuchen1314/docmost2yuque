package io.knowledge.platform.page;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
class PageReferenceExtractor {

    private static final String UUID_PATTERN =
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
    private static final Pattern PAGE_TOKEN = Pattern.compile(
            "\\[\\[page:(" + UUID_PATTERN + ")(?:\\|mode=(link|title|card))?]]",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern MENTION_TOKEN = Pattern.compile(
            "@\\[page:(" + UUID_PATTERN + ")]", Pattern.CASE_INSENSITIVE);
    private static final Pattern EMBED_TOKEN = Pattern.compile(
            "\\{\\{embed:(" + UUID_PATTERN + ")"
                    + "(?:#([\\p{L}\\p{N}_.:-]{1,200}))?"
                    + "\\|mode=(live|fixed)"
                    + "(?:\\|publication=(" + UUID_PATTERN + "))?}}",
            Pattern.CASE_INSENSITIVE);

    private final ObjectMapper objectMapper;

    PageReferenceExtractor(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    List<ExtractedPageReference> extract(JsonNode content) {
        List<ExtractedPageReference> references = new ArrayList<>();
        walk(content, "", references);
        if (references.size() > 200) {
            throw new IllegalArgumentException("A page cannot contain more than 200 references");
        }
        return List.copyOf(references);
    }

    private void walk(
            JsonNode node,
            String pointer,
            List<ExtractedPageReference> references) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            extractStructured(node, pointer, references);
            var fields = node.properties().iterator();
            while (fields.hasNext()) {
                var field = fields.next();
                if (field.getValue().isString()) {
                    extractTokens(
                            field.getValue().stringValue(),
                            pointer + "/" + escape(field.getKey()),
                            references);
                } else {
                    walk(field.getValue(), pointer + "/" + escape(field.getKey()), references);
                }
            }
            return;
        }
        if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                walk(node.get(index), pointer + "/" + index, references);
            }
        }
    }

    private void extractStructured(
            JsonNode node,
            String pointer,
            List<ExtractedPageReference> references) {
        String type = node.path("type").stringValue("").toLowerCase(Locale.ROOT);
        ReferenceKind kind = switch (type) {
            case "pagelink" -> ReferenceKind.LINK;
            case "pagemention" -> ReferenceKind.MENTION;
            case "embeddedcontent" -> ReferenceKind.EMBED;
            case "blockreference" -> ReferenceKind.BLOCK_REFERENCE;
            default -> null;
        };
        if (kind == null) {
            return;
        }
        JsonNode attributes = node.path("attrs").isObject() ? node.path("attrs") : node;
        if (!attributes.path("sourceType").stringValue("PAGE").equalsIgnoreCase("PAGE")) {
            return;
        }
        UUID targetPageId = firstUuid(attributes, "sourceId", "pageId", "targetPageId");
        if (targetPageId == null) {
            throw new IllegalArgumentException("A structured page reference requires a valid page id");
        }
        String blockId = optionalText(attributes.path("sourceBlockId"), 200);
        if (blockId != null && kind == ReferenceKind.EMBED) {
            kind = ReferenceKind.BLOCK_REFERENCE;
        }
        EmbedMode defaultMode = switch (kind) {
            case LINK -> EmbedMode.LINK;
            case MENTION -> EmbedMode.TITLE;
            case EMBED, BLOCK_REFERENCE -> EmbedMode.LIVE;
            case RELATION -> EmbedMode.CARD;
        };
        EmbedMode mode = mode(attributes.path("mode").stringValue(null), defaultMode);
        UUID fixedPublicationId =
                uuid(attributes.path("fixedPublicationId").stringValue(null));
        JsonNode displaySettings = attributes.path("displaySettings").isObject()
                ? attributes.path("displaySettings").deepCopy()
                : objectMapper.createObjectNode();
        add(
                references,
                targetPageId,
                blockId,
                kind,
                mode,
                fixedPublicationId,
                pointer.isEmpty() ? "/" : pointer,
                displaySettings);
    }

    private void extractTokens(
            String text,
            String pointer,
            List<ExtractedPageReference> references) {
        Matcher pages = PAGE_TOKEN.matcher(text);
        while (pages.find()) {
            EmbedMode mode = mode(pages.group(2), EmbedMode.LINK);
            add(
                    references,
                    UUID.fromString(pages.group(1)),
                    null,
                    ReferenceKind.LINK,
                    mode,
                    null,
                    pointer + "#" + pages.start(),
                    objectMapper.createObjectNode());
        }
        Matcher mentions = MENTION_TOKEN.matcher(text);
        while (mentions.find()) {
            add(
                    references,
                    UUID.fromString(mentions.group(1)),
                    null,
                    ReferenceKind.MENTION,
                    EmbedMode.TITLE,
                    null,
                    pointer + "#" + mentions.start(),
                    objectMapper.createObjectNode());
        }
        Matcher embeds = EMBED_TOKEN.matcher(text);
        while (embeds.find()) {
            String blockId = optionalText(embeds.group(2), 200);
            EmbedMode mode = mode(embeds.group(3), EmbedMode.LIVE);
            UUID publicationId = uuid(embeds.group(4));
            add(
                    references,
                    UUID.fromString(embeds.group(1)),
                    blockId,
                    blockId == null ? ReferenceKind.EMBED : ReferenceKind.BLOCK_REFERENCE,
                    mode,
                    publicationId,
                    pointer + "#" + embeds.start(),
                    objectMapper.createObjectNode());
        }
    }

    private static void add(
            List<ExtractedPageReference> references,
            UUID targetPageId,
            String targetBlockId,
            ReferenceKind kind,
            EmbedMode mode,
            UUID fixedPublicationId,
            String pointer,
            JsonNode displaySettings) {
        if (mode == EmbedMode.FIXED && fixedPublicationId == null) {
            throw new IllegalArgumentException("Fixed embeds require a publication id");
        }
        if (mode != EmbedMode.FIXED && fixedPublicationId != null) {
            throw new IllegalArgumentException("Only fixed embeds may specify a publication id");
        }
        references.add(new ExtractedPageReference(
                targetPageId,
                targetBlockId,
                kind,
                mode,
                fixedPublicationId,
                pointer,
                displaySettings,
                references.size()));
    }

    private static UUID firstUuid(JsonNode node, String... names) {
        for (String name : names) {
            UUID value = uuid(node.path(name).stringValue(null));
            if (value != null) {
                return value;
            }
        }
        return null;
    }

    private static UUID uuid(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static EmbedMode mode(String value, EmbedMode defaultMode) {
        if (value == null || value.isBlank()) {
            return defaultMode;
        }
        try {
            return EmbedMode.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Unsupported page reference mode");
        }
    }

    private static String optionalText(JsonNode value, int maximumLength) {
        return value == null || value.isNull()
                ? null
                : optionalText(value.stringValue(null), maximumLength);
    }

    private static String optionalText(String value, int maximumLength) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.length() > maximumLength) {
            throw new IllegalArgumentException("Page reference attribute is too long");
        }
        return normalized;
    }

    private static String escape(String value) {
        return value.replace("~", "~0").replace("/", "~1");
    }
}
