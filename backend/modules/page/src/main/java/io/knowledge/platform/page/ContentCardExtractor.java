package io.knowledge.platform.page;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
class ContentCardExtractor {

    private static final String UUID_PATTERN =
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
    private static final Pattern TOKEN = Pattern.compile(
            "\\{\\{card:([a-z0-9-]{1,64})"
                    + "\\|id=(" + UUID_PATTERN + ")"
                    + "\\|v=([1-9][0-9]{0,4})"
                    + "\\|data=([A-Za-z0-9_-]{1,350000})}}",
            Pattern.CASE_INSENSITIVE);

    private final ObjectMapper objectMapper;
    private final ContentCardRegistry registry;

    ContentCardExtractor(ObjectMapper objectMapper, ContentCardRegistry registry) {
        this.objectMapper = objectMapper;
        this.registry = registry;
    }

    List<ExtractedContentCard> extract(JsonNode content) {
        List<ExtractedContentCard> cards = new ArrayList<>();
        walk(content, "", cards);
        if (cards.size() > 100) {
            throw new IllegalArgumentException("A page cannot contain more than 100 content cards");
        }
        return List.copyOf(cards);
    }

    private void walk(JsonNode node, String pointer, List<ExtractedContentCard> cards) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isObject()) {
            extractStructured(node, pointer, cards);
            for (var property : node.properties()) {
                if (property.getValue().isString()) {
                    extractTokens(
                            property.getValue().stringValue(),
                            pointer + "/" + escape(property.getKey()),
                            cards);
                } else {
                    walk(
                            property.getValue(),
                            pointer + "/" + escape(property.getKey()),
                            cards);
                }
            }
            return;
        }
        if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                walk(node.get(index), pointer + "/" + index, cards);
            }
        }
    }

    private void extractStructured(
            JsonNode node,
            String pointer,
            List<ExtractedContentCard> cards) {
        if (!"contentcard".equals(
                node.path("type").stringValue("").toLowerCase(Locale.ROOT))) {
            return;
        }
        JsonNode attributes = node.path("attrs").isObject() ? node.path("attrs") : node;
        String cardId = attributes.path("cardId").stringValue(null);
        UUID instanceId = uuid(attributes.path("instanceId").stringValue(null));
        int version = attributes.path("version").isInt()
                ? attributes.path("version").intValue()
                : 0;
        JsonNode data = attributes.path("data");
        add(cards, instanceId, cardId, version, data, pointer.isEmpty() ? "/" : pointer);
    }

    private void extractTokens(
            String text,
            String pointer,
            List<ExtractedContentCard> cards) {
        Matcher matcher = TOKEN.matcher(text);
        while (matcher.find()) {
            JsonNode data;
            try {
                byte[] decoded = Base64.getUrlDecoder().decode(matcher.group(4));
                if (decoded.length > 256_000) {
                    throw new IllegalArgumentException("Content card data is too large");
                }
                data = objectMapper.readTree(new String(decoded, StandardCharsets.UTF_8));
            } catch (RuntimeException exception) {
                throw new IllegalArgumentException("Content card data encoding is invalid");
            }
            add(
                    cards,
                    UUID.fromString(matcher.group(2)),
                    matcher.group(1).toLowerCase(Locale.ROOT),
                    Integer.parseInt(matcher.group(3)),
                    data,
                    pointer + "#" + matcher.start());
        }
    }

    private void add(
            List<ExtractedContentCard> cards,
            UUID instanceId,
            String cardId,
            int version,
            JsonNode data,
            String pointer) {
        if (instanceId == null
                || cardId == null
                || !cardId.matches("[a-z0-9-]{1,64}")
                || version < 1
                || data == null
                || !data.isObject()) {
            throw new IllegalArgumentException("Content card node is invalid");
        }
        ContentCardDefinition definition = registry.find(cardId);
        boolean supported = definition != null && version <= definition.version();
        if (supported) {
            registry.validate(cardId, version, data);
        }
        cards.add(new ExtractedContentCard(
                instanceId,
                cardId,
                version,
                data.deepCopy(),
                pointer,
                cards.size(),
                supported));
    }

    private static UUID uuid(String value) {
        if (value == null) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static String escape(String value) {
        return value.replace("~", "~0").replace("/", "~1");
    }
}
