package io.knowledge.platform.social;
import java.time.OffsetDateTime;import java.util.List;import java.util.UUID;import tools.jackson.databind.JsonNode;
public record GardenView(UUID id,UUID userId,String ownerSlug,String ownerName,String slug,String title,String description,String icon,String coverUrl,String theme,JsonNode navigation,String seoTitle,String seoDescription,boolean discoverable,boolean rssEnabled,long followerCount,boolean followed,List<GardenKnowledgeBaseView> knowledgeBases,OffsetDateTime updatedAt) {}
