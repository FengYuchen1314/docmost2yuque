package io.knowledge.platform.integration;

import java.util.Set;import java.util.UUID;import tools.jackson.databind.JsonNode;

public final class ExternalApiModels {
    private ExternalApiModels(){}
    public record DocumentCreate(UUID knowledgeBaseId,String title,String path,String contentType,String icon,String cover,String publishMode,String visibilityOverride,JsonNode documentSettings,JsonNode content){}
    public record DocumentUpdate(UUID pageId,long expectedRevision,String title,String path,String icon,String cover,String publishMode,String visibilityOverride,JsonNode documentSettings,JsonNode content,Integer schemaVersion,String revisionKind,String revisionDescription){}
    public record Search(UUID workspaceId,String query,Set<String> types,int offset,int limit){}
    public record WebhookCreate(UUID workspaceId,String name,String endpointUrl,Set<String> events){}
}
