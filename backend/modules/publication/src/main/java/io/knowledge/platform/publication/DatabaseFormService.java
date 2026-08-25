package io.knowledge.platform.publication;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.page.PageService;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

@Service
public class DatabaseFormService {

    private static final int HOURLY_LIMIT = 30;
    private static final Pattern EMAIL = Pattern.compile(
            "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Set<String> COMPUTED = Set.of("FORMULA", "ROLLUP");
    private final DatabaseFormRepository repository;
    private final PageService pages;
    private final AuditService audit;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public DatabaseFormService(
            DatabaseFormRepository repository,
            PageService pages,
            AuditService audit,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.pages = pages;
        this.audit = audit;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public DatabaseFormSubmissionView submit(
            UUID submitterId,
            UUID publicationId,
            String idempotencyKey,
            JsonNode rawValues,
            String visitorFingerprint) {
        if (publicationId == null) {
            throw new IllegalArgumentException("Publication id is required");
        }
        String key = idempotencyKey(idempotencyKey);
        DatabaseFormRepository.SubmissionRow prior = repository.submission(publicationId, key);
        if (prior != null) {
            return new DatabaseFormSubmissionView(prior.rowId(), true, prior.createdAt());
        }
        DatabaseFormRepository.FormTarget target = repository.target(publicationId);
        if (target == null) throw new ResourceNotFoundException();
        FormDefinition definition = form(target.content());
        ObjectNode values = normalizeValues(definition, rawValues);
        String visitorHash = visitorHash(submitterId, visitorFingerprint);
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (repository.recentSubmissionCount(
                        target.pageId(), visitorHash, now.minusHours(1))
                >= HOURLY_LIMIT) {
            throw new DatabaseFormRateLimitedException();
        }
        UUID rowId = Ids.next();
        if (!repository.insert(
                Ids.next(), target, rowId, submitterId, visitorHash, key, values, now)) {
            DatabaseFormRepository.SubmissionRow duplicate = repository.submission(publicationId, key);
            if (duplicate == null) {
                throw new IllegalStateException("Form submission idempotency lookup failed");
            }
            return new DatabaseFormSubmissionView(
                    duplicate.rowId(), true, duplicate.createdAt());
        }
        pages.appendPublishedDatabaseFormRow(
                target.publishedBy(), target.pageId(), rowId, values, now);
        ObjectNode details = objectMapper.createObjectNode();
        details.put("publicationId", publicationId.toString());
        details.put("rowId", rowId.toString());
        details.put("fieldCount", values.size());
        audit.record(
                target.workspaceId(),
                submitterId,
                "database.form.submit",
                "PAGE",
                target.pageId(),
                "SUCCESS",
                objectMapper.writeValueAsString(details));
        return new DatabaseFormSubmissionView(rowId, false, now);
    }

    private FormDefinition form(JsonNode content) {
        JsonNode form = content.path("form");
        if (!form.isObject() || !form.path("enabled").asBoolean(false)) {
            throw new ResourceNotFoundException();
        }
        Map<String, FieldDefinition> available = new HashMap<>();
        for (JsonNode field : content.path("fields")) {
            String id = text(field.path("id"));
            String name = text(field.path("name"));
            String type = text(field.path("type")).toUpperCase(Locale.ROOT);
            if (!id.isEmpty() && !name.isEmpty() && !COMPUTED.contains(type)) {
                available.put(id, new FieldDefinition(
                        id, name, type, options(field.path("options"))));
            }
        }
        Set<String> configured = strings(form.path("fieldIds"));
        Set<String> required = strings(form.path("requiredFieldIds"));
        Map<String, FieldDefinition> exposed = new HashMap<>();
        for (var entry : available.entrySet()) {
            if (configured.isEmpty() || configured.contains(entry.getKey())) {
                exposed.put(entry.getKey(), entry.getValue());
            }
        }
        if (exposed.isEmpty() || !exposed.keySet().containsAll(required)) {
            throw new IllegalArgumentException("Published database form configuration is invalid");
        }
        return new FormDefinition(Map.copyOf(exposed), Set.copyOf(required));
    }

    private ObjectNode normalizeValues(FormDefinition form, JsonNode rawValues) {
        if (rawValues == null || !rawValues.isObject() || rawValues.size() > 50) {
            throw new IllegalArgumentException("Form values must be a JSON object with at most 50 fields");
        }
        for (var property : rawValues.properties()) {
            if (!form.fields().containsKey(property.getKey())) {
                throw new IllegalArgumentException("Form contains a field that is not exposed");
            }
        }
        ObjectNode normalized = objectMapper.createObjectNode();
        for (FieldDefinition field : form.fields().values()) {
            JsonNode value = rawValues.path(field.id());
            boolean empty = value.isMissingNode()
                    || value.isNull()
                    || value.isString() && value.stringValue().trim().isEmpty()
                    || value.isArray() && value.isEmpty();
            if (empty) {
                if (form.required().contains(field.id())) {
                    throw new IllegalArgumentException(field.name() + " is required");
                }
                continue;
            }
            normalized.set(field.id(), normalize(field, value));
        }
        return normalized;
    }

    private JsonNode normalize(FieldDefinition field, JsonNode value) {
        return switch (field.type()) {
            case "NUMBER" -> number(field.name(), value);
            case "CHECKBOX" -> checkbox(field.name(), value);
            case "SELECT" -> selection(field, value);
            case "MULTI_SELECT" -> selections(field, value);
            case "DATE" -> date(field.name(), value);
            case "EMAIL" -> email(field.name(), value);
            case "URL" -> url(field.name(), value);
            default -> string(field.name(), value, 4_000);
        };
    }

    private JsonNode number(String label, JsonNode value) {
        double number;
        try {
            number = value.isNumber()
                    ? value.asDouble()
                    : Double.parseDouble(text(value));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(label + " must be a number");
        }
        if (!Double.isFinite(number)) throw new IllegalArgumentException(label + " must be finite");
        return objectMapper.valueToTree(number);
    }

    private JsonNode checkbox(String label, JsonNode value) {
        if (!value.isBoolean()) throw new IllegalArgumentException(label + " must be true or false");
        return objectMapper.valueToTree(value.asBoolean());
    }

    private JsonNode selection(FieldDefinition field, JsonNode value) {
        String selected = stringValue(field.name(), value, 500);
        if (!field.options().isEmpty() && !field.options().contains(selected)) {
            throw new IllegalArgumentException(field.name() + " contains an invalid option");
        }
        return objectMapper.valueToTree(selected);
    }

    private JsonNode selections(FieldDefinition field, JsonNode value) {
        if (!value.isArray() || value.size() > 100) {
            throw new IllegalArgumentException(field.name() + " must be an array of options");
        }
        ArrayNode normalized = objectMapper.createArrayNode();
        Set<String> unique = new HashSet<>();
        for (JsonNode item : value) {
            String selected = stringValue(field.name(), item, 500);
            if (!field.options().isEmpty() && !field.options().contains(selected)) {
                throw new IllegalArgumentException(field.name() + " contains an invalid option");
            }
            if (unique.add(selected)) normalized.add(selected);
        }
        return normalized;
    }

    private JsonNode date(String label, JsonNode value) {
        String date = stringValue(label, value, 32);
        try {
            LocalDate.parse(date);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(label + " must be an ISO date");
        }
        return objectMapper.valueToTree(date);
    }

    private JsonNode email(String label, JsonNode value) {
        String email = stringValue(label, value, 320).toLowerCase(Locale.ROOT);
        if (!EMAIL.matcher(email).matches()) {
            throw new IllegalArgumentException(label + " must be a valid email address");
        }
        return objectMapper.valueToTree(email);
    }

    private JsonNode url(String label, JsonNode value) {
        String url = stringValue(label, value, 2_000);
        try {
            URI uri = URI.create(url);
            if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null) {
                throw new IllegalArgumentException();
            }
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(label + " must be an HTTP or HTTPS URL");
        }
        return objectMapper.valueToTree(url);
    }

    private JsonNode string(String label, JsonNode value, int maximum) {
        return objectMapper.valueToTree(stringValue(label, value, maximum));
    }

    private static String stringValue(String label, JsonNode value, int maximum) {
        if (!value.isString()) throw new IllegalArgumentException(label + " must be text");
        String text = value.stringValue().trim();
        if (text.length() > maximum) throw new IllegalArgumentException(label + " is too long");
        return text;
    }

    private static String idempotencyKey(String value) {
        if (value == null || value.trim().length() < 8 || value.trim().length() > 200) {
            throw new IllegalArgumentException("Idempotency key must be between 8 and 200 characters");
        }
        return value.trim();
    }

    private static String visitorHash(UUID submitterId, String fingerprint) {
        String source = submitterId == null
                ? fingerprint == null ? "unknown" : fingerprint
                : "user:" + submitterId;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(source.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static Set<String> strings(JsonNode value) {
        Set<String> values = new HashSet<>();
        if (value.isArray()) {
            for (JsonNode item : value) {
                String text = text(item);
                if (!text.isEmpty()) values.add(text);
            }
        }
        return values;
    }

    private static Set<String> options(JsonNode value) {
        return Set.copyOf(strings(value));
    }

    private static String text(JsonNode value) {
        return value != null && value.isString() ? value.stringValue().trim() : "";
    }

    private record FormDefinition(
            Map<String, FieldDefinition> fields,
            Set<String> required) {}

    private record FieldDefinition(
            String id,
            String name,
            String type,
            Set<String> options) {}
}
