package io.knowledge.platform.social;
import java.time.OffsetDateTime;import java.util.Map;import java.util.Set;import java.util.UUID;
public record PublicContentView(UUID publicationId,UUID pageId,UUID knowledgeBaseId,String knowledgeBaseName,String title,String path,String contentType,String preview,UUID authorId,String authorSlug,String authorName,String authorAvatar,Map<String,Long> reactions,Set<String> viewerReactions,OffsetDateTime publishedAt) {}
