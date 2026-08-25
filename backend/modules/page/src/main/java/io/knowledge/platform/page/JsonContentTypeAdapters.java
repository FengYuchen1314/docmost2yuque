package io.knowledge.platform.page;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

final class JsonContentTypeAdapters {

    private JsonContentTypeAdapters() {}

    abstract static class BaseAdapter implements ContentTypeAdapter {

        private static final Set<String> STRUCTURAL_TEXT_FIELDS = Set.of(
                "type",
                "id",
                "mode",
                "sourcetype",
                "sourceid",
                "sourceblockid",
                "pageid",
                "targetpageid",
                "fixedpublicationid",
                "schemaversion");

        final ObjectMapper objectMapper;

        BaseAdapter(ObjectMapper objectMapper) {
            this.objectMapper = objectMapper;
        }

        @Override
        public void validate(JsonNode content, int schemaVersion) {
            if (content == null || !content.isObject()) {
                throw new IllegalArgumentException("Content must be a JSON object");
            }
            if (schemaVersion < 1) {
                throw new IllegalArgumentException("Content schema version is invalid");
            }
        }

        @Override
        public String extractPlainText(JsonNode content) {
            List<String> values = new ArrayList<>();
            collectText(content, null, values);
            return String.join(" ", values).trim();
        }

        private static void collectText(
                JsonNode value,
                String fieldName,
                List<String> output) {
            if (value == null || value.isNull()) {
                return;
            }
            if (value.isString()) {
                String normalizedField =
                        fieldName == null ? "" : fieldName.toLowerCase(Locale.ROOT);
                if (!STRUCTURAL_TEXT_FIELDS.contains(normalizedField)
                        && !normalizedField.endsWith("id")) {
                    String text = value.stringValue().trim();
                    if (!text.isEmpty()) {
                        output.add(text);
                    }
                }
                return;
            }
            if (value.isObject()) {
                for (var property : value.properties()) {
                    collectText(property.getValue(), property.getKey(), output);
                }
                return;
            }
            if (value.isArray()) {
                for (JsonNode child : value) {
                    collectText(child, fieldName, output);
                }
            }
        }

        ObjectNode empty(String type) {
            ObjectNode root = objectMapper.createObjectNode();
            root.put("type", type);
            root.putArray("content");
            return root;
        }
    }

    @Component
    static final class DocumentAdapter extends BaseAdapter {

        DocumentAdapter(ObjectMapper objectMapper) {
            super(objectMapper);
        }

        @Override
        public ContentType type() {
            return ContentType.DOCUMENT;
        }

        @Override
        public JsonNode createEmptyContent() {
            return empty("doc");
        }
    }

    @Component
    static final class WhiteboardAdapter extends BaseAdapter {

        WhiteboardAdapter(ObjectMapper objectMapper) {
            super(objectMapper);
        }

        @Override
        public ContentType type() {
            return ContentType.WHITEBOARD;
        }

        @Override
        public JsonNode createEmptyContent() {
            ObjectNode root = objectMapper.createObjectNode();
            root.put("type", "whiteboard");
            ObjectNode viewport = root.putObject("viewport");
            viewport.put("x", 0);
            viewport.put("y", 0);
            viewport.put("zoom", 1);
            root.putArray("elements");
            return root;
        }
    }

    @Component
    static final class SpreadsheetAdapter extends BaseAdapter {

        SpreadsheetAdapter(ObjectMapper objectMapper) {
            super(objectMapper);
        }

        @Override
        public ContentType type() {
            return ContentType.SPREADSHEET;
        }

        @Override
        public JsonNode createEmptyContent() {
            return empty("workbook");
        }
    }

    @Component
    static final class DatabaseAdapter extends BaseAdapter {

        DatabaseAdapter(ObjectMapper objectMapper) {
            super(objectMapper);
        }

        @Override
        public ContentType type() {
            return ContentType.DATABASE;
        }

        @Override
        public JsonNode createEmptyContent() {
            return empty("database");
        }
    }
}
