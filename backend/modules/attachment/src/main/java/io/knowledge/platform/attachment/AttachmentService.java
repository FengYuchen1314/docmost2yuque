package io.knowledge.platform.attachment;

import io.knowledge.platform.audit.AuditService;
import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.Ids;
import io.knowledge.platform.search.SearchDocumentCommand;
import io.knowledge.platform.search.SearchIndexWriter;
import java.io.InputStream;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

@Service
public class AttachmentService implements AttachmentReferenceValidator {

    private static final Pattern MEDIA_TYPE =
            Pattern.compile("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+");
    private static final System.Logger LOGGER =
            System.getLogger(AttachmentService.class.getName());

    private final AttachmentRepository repository;
    private final AttachmentStorage storage;
    private final AuthorizationService authorization;
    private final AuditService audit;
    private final AttachmentTextExtractor extractor;
    private final SearchIndexWriter searchIndex;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final long maximumBytes;

    public AttachmentService(
            AttachmentRepository repository,
            AttachmentStorage storage,
            AuthorizationService authorization,
            AuditService audit,
            AttachmentTextExtractor extractor,
            SearchIndexWriter searchIndex,
            ObjectMapper mapper,
            Clock clock,
            @Value("${platform.storage.maximum-file-size-bytes:52428800}") long maximumBytes) {
        this.repository = repository;
        this.storage = storage;
        this.authorization = authorization;
        this.audit = audit;
        this.extractor = extractor;
        this.searchIndex = searchIndex;
        this.mapper = mapper;
        this.clock = clock;
        this.maximumBytes = Math.max(1_048_576L, maximumBytes);
    }

    @Transactional
    public AttachmentView upload(
            UUID actorId,
            UUID workspaceId,
            UUID pageId,
            String originalName,
            String mediaType,
            long declaredSize,
            InputStream input) {
        if (actorId == null || input == null) {
            throw new IllegalArgumentException("Uploader and file are required");
        }
        if (declaredSize <= 0 || declaredSize > maximumBytes) {
            throw new IllegalArgumentException("Attachment must be between 1 byte and 50 MB");
        }
        UUID resolvedWorkspaceId = resolveWorkspace(workspaceId, pageId);
        authorize(actorId, resolvedWorkspaceId, pageId, Capability.EDIT);
        UUID attachmentId = Ids.next();
        String storageKey = resolvedWorkspaceId + "/" + attachmentId;
        AttachmentStorage.StoredObject stored = storage.store(storageKey, input, maximumBytes);
        registerRollbackCleanup(storageKey);
        OffsetDateTime now = OffsetDateTime.now(clock);
        String name=cleanName(originalName);String type=cleanMediaType(mediaType);
        AttachmentTextExtractor.Extraction extraction=extractor.extract(storage.load(storageKey),name,type,stored.sizeBytes());
        AttachmentRepository.AttachmentRecord record = new AttachmentRepository.AttachmentRecord(
                attachmentId,
                resolvedWorkspaceId,
                pageId,
                name,
                type,
                stored.sizeBytes(),
                stored.checksumSha256(),
                storageKey,
                actorId,
                extraction.text(),
                extraction.status(),
                now,
                now);
        repository.insert(record);
        index(record);
        audit.success(resolvedWorkspaceId, actorId, "attachment.upload", "ATTACHMENT", attachmentId);
        return view(record);
    }

    @Transactional(readOnly = true)
    public AttachmentContent content(UUID actorId, UUID attachmentId) {
        AttachmentRepository.AttachmentRecord record = require(attachmentId);
        authorize(actorId, record.workspaceId(), record.pageId(), Capability.READ);
        return new AttachmentContent(view(record), storage.load(record.storageKey()));
    }

    @Transactional(readOnly = true)
    public AttachmentContent publicContent(UUID attachmentId) {
        AttachmentRepository.AttachmentRecord record = require(attachmentId);
        if (record.pageId() == null
                || !repository.pagePubliclyReadable(record.pageId(), record.id())) {
            throw new ResourceNotFoundException();
        }
        return new AttachmentContent(view(record), storage.load(record.storageKey()));
    }

    @Transactional(readOnly = true)
    public AttachmentContent sharedContent(
            UUID pageId, UUID publicationId, UUID attachmentId) {
        AttachmentRepository.AttachmentRecord record = require(attachmentId);
        if (pageId == null
                || publicationId == null
                || !pageId.equals(record.pageId())
                || !repository.publicationContainsAttachment(
                        pageId, publicationId, attachmentId)) {
            throw new ResourceNotFoundException();
        }
        return new AttachmentContent(view(record), storage.load(record.storageKey()));
    }

    @Transactional(readOnly = true)
    public AttachmentView get(UUID actorId, UUID attachmentId) {
        AttachmentRepository.AttachmentRecord record = require(attachmentId);
        authorize(actorId, record.workspaceId(), record.pageId(), Capability.READ);
        return view(record);
    }

    @Override
    @Transactional(readOnly = true)
    public void requirePageAttachment(UUID pageId, UUID attachmentId) {
        AttachmentRepository.AttachmentRecord record = require(attachmentId);
        if (pageId == null || !pageId.equals(record.pageId())) {
            throw new ResourceNotFoundException();
        }
    }

    @Transactional(readOnly = true)
    public List<AttachmentView> listPage(UUID actorId, UUID pageId) {
        authorization.require(actorId, ResourceType.PAGE, pageId, Capability.READ);
        return repository.listPage(pageId).stream().map(AttachmentService::view).toList();
    }

    @Transactional
    public void delete(UUID actorId, UUID attachmentId) {
        AttachmentRepository.AttachmentRecord record = require(attachmentId);
        authorize(actorId, record.workspaceId(), record.pageId(), Capability.EDIT);
        if (!repository.softDelete(attachmentId, OffsetDateTime.now(clock))) {
            throw new ResourceNotFoundException();
        }
        registerCommitDelete(record.storageKey());
        searchIndex.delete(attachmentId);
        audit.success(
                record.workspaceId(), actorId, "attachment.delete", "ATTACHMENT", attachmentId);
    }

    private void authorize(
            UUID actorId,
            UUID workspaceId,
            UUID pageId,
            Capability capability) {
        if (pageId == null) {
            authorization.require(actorId, ResourceType.WORKSPACE, workspaceId, capability);
            return;
        }
        UUID actualWorkspace = repository.pageWorkspace(pageId);
        if (!workspaceId.equals(actualWorkspace)) throw new ResourceNotFoundException();
        authorization.require(actorId, ResourceType.PAGE, pageId, capability);
    }

    private UUID resolveWorkspace(UUID requestedWorkspaceId, UUID pageId) {
        if (pageId == null) {
            if (requestedWorkspaceId == null) {
                throw new IllegalArgumentException("Workspace is required for unattached files");
            }
            return requestedWorkspaceId;
        }
        UUID actualWorkspaceId = repository.pageWorkspace(pageId);
        if (actualWorkspaceId == null) throw new ResourceNotFoundException();
        if (requestedWorkspaceId != null && !requestedWorkspaceId.equals(actualWorkspaceId)) {
            throw new ResourceNotFoundException();
        }
        return actualWorkspaceId;
    }

    private AttachmentRepository.AttachmentRecord require(UUID attachmentId) {
        if (attachmentId == null) throw new IllegalArgumentException("Attachment id is required");
        AttachmentRepository.AttachmentRecord record = repository.findActive(attachmentId);
        if (record == null) throw new ResourceNotFoundException();
        return record;
    }

    private void registerRollbackCleanup(String storageKey) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status == TransactionSynchronization.STATUS_ROLLED_BACK) {
                    safeDelete(storageKey);
                }
            }
        });
    }

    private void registerCommitDelete(String storageKey) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                safeDelete(storageKey);
            }
        });
    }

    private void safeDelete(String storageKey) {
        try {
            storage.delete(storageKey);
        } catch (RuntimeException exception) {
            LOGGER.log(System.Logger.Level.WARNING,
                    "Attachment object cleanup failed for {0}", storageKey);
        }
    }

    private void index(AttachmentRepository.AttachmentRecord record){
        AttachmentRepository.PageSearchContext context=repository.pageSearchContext(record.pageId());
        var metadata=mapper.createObjectNode();metadata.put("mediaType",record.mediaType()).put("sizeBytes",record.sizeBytes()).put("extractionStatus",record.extractionStatus()).put("contentUrl","/api/v1/attachments/"+record.id()+"/content");
        if(record.pageId()!=null)metadata.put("pageId",record.pageId().toString());
        if(context!=null)metadata.put("knowledgeBaseId",context.knowledgeBaseId().toString()).put("pageTitle",context.pageTitle());
        String body=(context==null?"":context.pageTitle()+"\n")+record.mediaType()+"\n"+record.extractedText();
        searchIndex.upsert(new SearchDocumentCommand(record.id(),record.workspaceId(),"ATTACHMENT",record.id(),"CANONICAL",record.originalName(),body,List.of(extension(record.originalName()),record.mediaType()),record.pageId()==null?null:record.pageId().toString(),record.uploadedBy(),attachmentType(record.originalName(),record.mediaType()),"WORKSPACE",null,0,metadata,record.createdAt(),record.extractedAt()==null?record.createdAt():record.extractedAt()));
    }

    private static String extension(String name){int dot=name.lastIndexOf('.');return dot<0?"file":name.substring(dot+1).toLowerCase(Locale.ROOT);}
    private static String attachmentType(String name,String mediaType){String ext=extension(name).toUpperCase(Locale.ROOT);if(!"FILE".equals(ext)&&ext.matches("[A-Z0-9]{1,16}"))return ext;if(mediaType.startsWith("image/"))return "IMAGE";if(mediaType.startsWith("audio/"))return "AUDIO";if(mediaType.startsWith("video/"))return "VIDEO";return "FILE";}

    private static AttachmentView view(AttachmentRepository.AttachmentRecord record) {
        return new AttachmentView(
                record.id(),
                record.workspaceId(),
                record.pageId(),
                record.originalName(),
                record.mediaType(),
                record.sizeBytes(),
                record.checksumSha256(),
                record.uploadedBy(),
                record.extractionStatus(),
                record.extractedAt(),
                record.createdAt(),
                "/api/v1/attachments/" + record.id() + "/content");
    }

    private static String cleanName(String value) {
        String name = value == null ? "attachment" : value.replace('\\', '/');
        int separator = name.lastIndexOf('/');
        if (separator >= 0) name = name.substring(separator + 1);
        name = name.replaceAll("[\\p{Cntrl}]", "").trim();
        if (name.isBlank()) name = "attachment";
        return name.length() > 255 ? name.substring(0, 255) : name;
    }

    private static String cleanMediaType(String value) {
        if (value == null) return "application/octet-stream";
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return MEDIA_TYPE.matcher(normalized).matches()
                ? normalized
                : "application/octet-stream";
    }
}
