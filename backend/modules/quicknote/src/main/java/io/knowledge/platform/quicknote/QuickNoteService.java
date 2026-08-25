package io.knowledge.platform.quicknote;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.page.ContentType;
import io.knowledge.platform.page.CreatePageCommand;
import io.knowledge.platform.page.PageService;
import io.knowledge.platform.page.PageView;
import io.knowledge.platform.search.SearchDocumentCommand;
import io.knowledge.platform.search.SearchIndexWriter;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

@Service
public class QuickNoteService {

    private static final Set<String> SOURCES =
            Set.of("HOME", "QUICK_NOTE_PAGE", "API", "IMPORT");
    private static final Set<String> SAVE_KINDS = Set.of("AUTO_SAVE", "COMMIT");
    private static final Set<String> COLORS = Set.of(
            "GRAY", "RED", "ORANGE", "YELLOW", "GREEN", "BLUE", "PURPLE", "PINK");
    private final QuickNoteRepository repository;
    private final AuthorizationService authorization;
    private final PageService pages;
    private final AuditService auditService;
    private final SearchIndexWriter searchIndex;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public QuickNoteService(
            QuickNoteRepository repository,
            AuthorizationService authorization,
            PageService pages,
            AuditService auditService,
            SearchIndexWriter searchIndex,
            ObjectMapper objectMapper,
            Clock clock) {
        this.repository = repository;
        this.authorization = authorization;
        this.pages = pages;
        this.auditService = auditService;
        this.searchIndex = searchIndex;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Transactional
    public QuickNoteView create(
            UUID actorId,
            UUID workspaceId,
            JsonNode content,
            String plainText,
            String source,
            UUID clientRequestId,
            Set<UUID> tagIds) {
        if (workspaceId == null) throw new IllegalArgumentException("Workspace id is required");
        authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, Capability.READ);
        validateContent(content, plainText, false);
        QuickNoteView duplicate = repository.findByClientRequest(actorId, clientRequestId);
        if (duplicate != null) return duplicate;
        String normalizedSource = normalize(source, SOURCES, "QUICK_NOTE_PAGE", "Quick note source");
        UUID id = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        try {
            repository.insert(
                    id, workspaceId, actorId, content, normalizeText(plainText),
                    normalizedSource, clientRequestId, now);
        } catch (DuplicateKeyException exception) {
            QuickNoteView raced = repository.findByClientRequest(actorId, clientRequestId);
            if (raced != null) return raced;
            throw exception;
        }
        repository.insertRevision(
                Ids.next(), id, 1, "CREATE", content, normalizeText(plainText), now);
        applyTags(actorId, id, tagIds == null ? Set.of() : tagIds, true, now);
        auditService.success(workspaceId, actorId, "quick-note.create", "QUICK_NOTE", id);
        QuickNoteView created = requireOwned(actorId, id);
        synchronizeSearch(created);
        return created;
    }

    @Transactional(readOnly = true)
    public List<QuickNoteView> list(
            UUID actorId, String status, UUID tagId, String query, int limit, int offset) {
        String normalizedStatus = normalize(
                status, Set.of("ACTIVE", "ARCHIVED", "DELETED"), "ACTIVE", "Quick note status");
        if (tagId != null && repository.findTag(tagId, actorId) == null) {
            throw new ResourceNotFoundException();
        }
        return repository.list(
                actorId, normalizedStatus, tagId, query,
                Math.max(1, Math.min(limit, 200)), Math.max(0, offset));
    }

    @Transactional(readOnly = true)
    public QuickNotePageView page(UUID actorId,String status,UUID tagId,String query,int limit,int offset){
        String normalizedStatus=normalize(status,Set.of("ACTIVE","ARCHIVED","DELETED"),"ACTIVE","Quick note status");
        if(tagId!=null&&repository.findTag(tagId,actorId)==null)throw new ResourceNotFoundException();
        int count=Math.max(1,Math.min(limit,50)),start=Math.max(0,Math.min(offset,1_000_000));
        List<QuickNoteView> rows=repository.list(actorId,normalizedStatus,tagId,query,count+1,start);
        boolean more=rows.size()>count;List<QuickNoteView> items=List.copyOf(rows.subList(0,Math.min(rows.size(),count)));
        return new QuickNotePageView(items,start+items.size(),more);
    }

    @Transactional
    public QuickNoteView save(
            UUID actorId,
            UUID noteId,
            long expectedRevision,
            JsonNode content,
            String plainText,
            String kind) {
        QuickNoteView current = requireOwned(actorId, noteId);
        if (!"ACTIVE".equals(current.status())) {
            throw new DomainConflictException(
                    "QUICK_NOTE_NOT_ACTIVE", "Only active quick notes can be edited");
        }
        validateContent(content, plainText, true);
        String normalizedKind = normalize(kind, SAVE_KINDS, "AUTO_SAVE", "Quick note save kind");
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (!repository.updateContent(
                noteId, actorId, expectedRevision, content, normalizeText(plainText), now)) {
            throw new DomainConflictException(
                    "QUICK_NOTE_REVISION_CONFLICT",
                    "The quick note changed since it was loaded; reload before saving again");
        }
        repository.insertRevision(
                Ids.next(), noteId, expectedRevision + 1, normalizedKind,
                content, normalizeText(plainText), now);
        auditService.success(
                current.workspaceId(), actorId,
                "AUTO_SAVE".equals(normalizedKind) ? "quick-note.auto-save" : "quick-note.commit",
                "QUICK_NOTE", noteId);
        QuickNoteView saved = requireOwned(actorId, noteId);
        synchronizeSearch(saved);
        return saved;
    }

    @Transactional
    public QuickNoteView archive(UUID actorId, UUID noteId, boolean archived) {
        QuickNoteView current = requireOwned(actorId, noteId);
        if ("DELETED".equals(current.status())) {
            throw new DomainConflictException(
                    "QUICK_NOTE_DELETED", "Restore the quick note before archiving it");
        }
        setStatus(actorId, current, archived ? "ARCHIVED" : "ACTIVE");
        return requireOwned(actorId, noteId);
    }

    @Transactional
    public void delete(UUID actorId, UUID noteId) {
        QuickNoteView current = requireOwned(actorId, noteId);
        setStatus(actorId, current, "DELETED");
    }

    @Transactional
    public QuickNoteView restore(UUID actorId, UUID noteId) {
        QuickNoteView current = requireOwned(actorId, noteId);
        if (!"DELETED".equals(current.status())) {
            throw new DomainConflictException(
                    "QUICK_NOTE_NOT_DELETED", "Only deleted quick notes can be restored");
        }
        setStatus(actorId, current, "ACTIVE");
        return requireOwned(actorId, noteId);
    }

    @Transactional
    public List<QuickNoteView> batch(
            UUID actorId, Set<UUID> noteIds, String operation, Set<UUID> tagIds) {
        List<QuickNoteView> selected = requireBatch(actorId, noteIds);
        String normalized = normalize(
                operation,
                Set.of("ARCHIVE", "UNARCHIVE", "DELETE", "RESTORE", "ADD_TAG", "REMOVE_TAG"),
                null,
                "Quick note batch operation");
        OffsetDateTime now = OffsetDateTime.now(clock);
        for (QuickNoteView note : selected) {
            switch (normalized) {
                case "ARCHIVE" -> {
                    if (!"DELETED".equals(note.status())) setStatus(actorId, note, "ARCHIVED");
                }
                case "UNARCHIVE" -> {
                    if ("ARCHIVED".equals(note.status())) setStatus(actorId, note, "ACTIVE");
                }
                case "DELETE" -> setStatus(actorId, note, "DELETED");
                case "RESTORE" -> {
                    if ("DELETED".equals(note.status())) setStatus(actorId, note, "ACTIVE");
                }
                case "ADD_TAG" -> applyTags(actorId, note.id(), requireTags(tagIds), true, now);
                case "REMOVE_TAG" -> applyTags(actorId, note.id(), requireTags(tagIds), false, now);
                default -> throw new IllegalStateException("Unsupported quick note batch operation");
            }
        }
        List<QuickNoteView> result = selected.stream()
                .map(note -> requireOwned(actorId, note.id()))
                .toList();
        result.forEach(this::synchronizeSearch);
        return result;
    }

    @Transactional(readOnly = true)
    public List<QuickNoteRevisionView> history(UUID actorId, UUID noteId, int limit) {
        requireOwned(actorId, noteId);
        return repository.history(noteId, Math.max(1, Math.min(limit, 200)), 0);
    }

    @Transactional(readOnly = true)
    public QuickNoteHistoryPageView historyPage(
            UUID actorId, UUID noteId, int limit, int offset) {
        requireOwned(actorId, noteId);
        int count = Math.max(1, Math.min(limit, 50));
        int start = Math.max(0, Math.min(offset, 1_000_000));
        List<QuickNoteRevisionView> rows = repository.history(noteId, count + 1, start);
        boolean hasMore = rows.size() > count;
        List<QuickNoteRevisionView> items = List.copyOf(
                rows.subList(0, Math.min(rows.size(), count)));
        return new QuickNoteHistoryPageView(items, start + items.size(), hasMore);
    }

    @Transactional
    public QuickNoteView restoreRevision(UUID actorId, UUID noteId, long revision) {
        QuickNoteView current = requireOwned(actorId, noteId);
        if (!"ACTIVE".equals(current.status())) {
            throw new DomainConflictException(
                    "QUICK_NOTE_NOT_ACTIVE", "Restore the quick note before restoring its history");
        }
        QuickNoteRevisionView snapshot = repository.revision(noteId, revision);
        if (snapshot == null) throw new ResourceNotFoundException();
        OffsetDateTime now = OffsetDateTime.now(clock);
        if (!repository.updateContent(
                noteId, actorId, current.revision(), snapshot.content(), snapshot.plainText(), now)) {
            throw new DomainConflictException(
                    "QUICK_NOTE_REVISION_CONFLICT", "The quick note changed during history restore");
        }
        repository.insertRevision(
                Ids.next(), noteId, current.revision() + 1, "RESTORE",
                snapshot.content(), snapshot.plainText(), now);
        auditService.success(
                current.workspaceId(), actorId, "quick-note.restore-revision", "QUICK_NOTE", noteId);
        QuickNoteView restored = requireOwned(actorId, noteId);
        synchronizeSearch(restored);
        return restored;
    }

    @Transactional(readOnly = true)
    public List<QuickNoteTagView> tags(UUID actorId) {
        return repository.tags(actorId);
    }

    @Transactional
    public QuickNoteTagView createTag(UUID actorId, String name, String color) {
        UUID id = Ids.next();
        OffsetDateTime now = OffsetDateTime.now(clock);
        try {
            repository.insertTag(id, actorId, tagName(name), tagColor(color), now);
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException(
                    "QUICK_NOTE_TAG_NAME_CONFLICT", "A quick note tag with this name already exists");
        }
        return requireTag(actorId, id);
    }

    @Transactional
    public QuickNoteTagView updateTag(UUID actorId, UUID tagId, String name, String color) {
        requireTag(actorId, tagId);
        try {
            if (!repository.updateTag(tagId, actorId, tagName(name), tagColor(color), OffsetDateTime.now(clock))) {
                throw new ResourceNotFoundException();
            }
        } catch (DuplicateKeyException exception) {
            throw new DomainConflictException(
                    "QUICK_NOTE_TAG_NAME_CONFLICT", "A quick note tag with this name already exists");
        }
        return requireTag(actorId, tagId);
    }

    @Transactional
    public void deleteTag(UUID actorId, UUID tagId) {
        if (!repository.deleteTag(tagId, actorId)) throw new ResourceNotFoundException();
    }

    @Transactional
    public PageView convert(
            UUID actorId,
            Set<UUID> noteIds,
            UUID knowledgeBaseId,
            String title,
            String path) {
        List<QuickNoteView> selected = requireBatch(actorId, noteIds);
        if (selected.stream().anyMatch(note -> "DELETED".equals(note.status()))) {
            throw new DomainConflictException(
                    "QUICK_NOTE_DELETED", "Deleted quick notes cannot be converted");
        }
        JsonNode content = selected.size() == 1
                ? selected.getFirst().content()
                : mergeContent(selected);
        PageView page = pages.create(
                actorId,
                new CreatePageCommand(
                        knowledgeBaseId, pageTitle(title, selected), path,
                        ContentType.DOCUMENT, null, null, "INHERIT", "INHERIT",
                        objectMapper.createObjectNode(), content));
        OffsetDateTime now = OffsetDateTime.now(clock);
        for (QuickNoteView note : selected) {
            repository.insertConversion(note.id(), page.id(), now);
            setStatus(actorId, note, "ARCHIVED");
        }
        auditService.success(
                page.workspaceId(), actorId,
                selected.size() == 1 ? "quick-note.convert" : "quick-note.merge",
                "PAGE", page.id());
        return page;
    }

    private void applyTags(
            UUID actorId,
            UUID noteId,
            Set<UUID> tagIds,
            boolean selected,
            OffsetDateTime now) {
        for (UUID tagId : tagIds) {
            requireTag(actorId, tagId);
            repository.setTag(noteId, tagId, selected, now);
        }
    }

    private List<QuickNoteView> requireBatch(UUID actorId, Set<UUID> noteIds) {
        if (noteIds == null || noteIds.isEmpty() || noteIds.size() > 100) {
            throw new IllegalArgumentException("Select between 1 and 100 quick notes");
        }
        List<QuickNoteView> result = new ArrayList<>();
        for (UUID id : new LinkedHashSet<>(noteIds)) result.add(requireOwned(actorId, id));
        return result;
    }

    private QuickNoteView requireOwned(UUID actorId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Quick note id is required");
        QuickNoteView note = repository.findOwned(id, actorId);
        if (note == null) throw new ResourceNotFoundException();
        return note;
    }

    private QuickNoteTagView requireTag(UUID actorId, UUID id) {
        if (id == null) throw new IllegalArgumentException("Quick note tag id is required");
        QuickNoteTagView tag = repository.findTag(id, actorId);
        if (tag == null) throw new ResourceNotFoundException();
        return tag;
    }

    private void setStatus(UUID actorId, QuickNoteView note, String status) {
        if (status.equals(note.status())) return;
        if (!repository.setStatus(note.id(), actorId, status, OffsetDateTime.now(clock))) {
            throw new ResourceNotFoundException();
        }
        auditService.success(
                note.workspaceId(), actorId, "quick-note." + status.toLowerCase(Locale.ROOT),
                "QUICK_NOTE", note.id());
        synchronizeSearch(requireOwned(actorId, note.id()));
    }

    private void synchronizeSearch(QuickNoteView note) {
        if ("DELETED".equals(note.status())) {
            searchIndex.delete(note.id());
            return;
        }
        ObjectNode metadata = objectMapper.createObjectNode();
        metadata.put("status", note.status());
        metadata.put("source", note.source());
        metadata.put("revision", note.revision());
        searchIndex.upsert(new SearchDocumentCommand(
                note.id(),
                note.workspaceId(),
                "QUICK_NOTE",
                note.id(),
                "CANONICAL",
                quickNoteTitle(note.plainText()),
                note.plainText(),
                note.tags().stream().map(QuickNoteTagView::name).toList(),
                null,
                note.userId(),
                "DOCUMENT",
                "PRIVATE",
                null,
                authorization.permissionVersion(note.workspaceId()),
                metadata,
                note.createdAt(),
                note.updatedAt()));
    }

    private static String quickNoteTitle(String value) {
        String normalized = normalizeText(value);
        if (normalized.isBlank()) return "Quick note";
        String firstLine = normalized.lines().findFirst().orElse("Quick note").strip();
        return firstLine.substring(0, Math.min(firstLine.length(), 120));
    }

    private JsonNode mergeContent(List<QuickNoteView> notes) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("type", "doc");
        ArrayNode output = root.putArray("content");
        for (QuickNoteView note : notes) {
            JsonNode children = note.content().get("content");
            if (children != null && children.isArray()) {
                for (JsonNode child : children) output.add(child.deepCopy());
            } else if (!note.plainText().isBlank()) {
                ObjectNode paragraph = output.addObject();
                paragraph.put("type", "paragraph");
                ObjectNode text = paragraph.putArray("content").addObject();
                text.put("type", "text");
                text.put("text", note.plainText());
            }
        }
        return root;
    }

    private static void validateContent(JsonNode content, String plainText, boolean allowEmpty) {
        if (content == null || !content.isObject()) {
            throw new IllegalArgumentException("Quick note content must be a JSON object");
        }
        String normalized = normalizeText(plainText);
        if (!allowEmpty && normalized.isBlank()) {
            throw new IllegalArgumentException("Quick note content is required");
        }
        if (normalized.length() > 100_000) {
            throw new IllegalArgumentException("Quick note content is too long");
        }
    }

    private static String normalizeText(String value) {
        return value == null ? "" : value.strip();
    }

    private static String normalize(
            String value, Set<String> allowed, String fallback, String label) {
        String normalized = value == null ? fallback : value.trim().toUpperCase(Locale.ROOT);
        if (normalized == null || !allowed.contains(normalized)) {
            throw new IllegalArgumentException(label + " is invalid");
        }
        return normalized;
    }

    private static String tagName(String value) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > 80) {
            throw new IllegalArgumentException("Quick note tag name must be between 1 and 80 characters");
        }
        return value.trim();
    }

    private static String tagColor(String value) {
        return normalize(value, COLORS, "GRAY", "Quick note tag color");
    }

    private static Set<UUID> requireTags(Set<UUID> value) {
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException("At least one quick note tag is required");
        }
        return value;
    }

    private static String pageTitle(String title, List<QuickNoteView> notes) {
        if (title != null && !title.isBlank()) return title.trim();
        String plain = notes.getFirst().plainText().strip();
        if (plain.isEmpty()) return "Quick note";
        int end = Math.min(plain.length(), 80);
        return plain.substring(0, end).lines().findFirst().orElse("Quick note");
    }
}
