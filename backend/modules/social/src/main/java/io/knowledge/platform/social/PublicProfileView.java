package io.knowledge.platform.social;

import java.time.OffsetDateTime;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public record PublicProfileView(UUID userId,String slug,String displayName,String bio,String avatarUrl,String coverUrl,String theme,JsonNode navigation,String seoTitle,String seoDescription,boolean discoverable,boolean rssEnabled,long followerCount,long followingCount,boolean followed,OffsetDateTime updatedAt) {}
