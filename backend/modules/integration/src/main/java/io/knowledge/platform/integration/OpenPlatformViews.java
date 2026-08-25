package io.knowledge.platform.integration;

import java.time.OffsetDateTime;import java.util.List;import java.util.Set;import java.util.UUID;

public final class OpenPlatformViews {
    private OpenPlatformViews(){}
    public record ApiKey(UUID id,UUID workspaceId,String name,String prefix,Set<String> scopes,OffsetDateTime lastUsedAt,OffsetDateTime expiresAt,OffsetDateTime revokedAt,OffsetDateTime createdAt,String secret){}
    public record OAuthClient(UUID id,UUID workspaceId,String clientId,String name,List<String> redirectUris,Set<String> scopes,boolean publicClient,boolean active,OffsetDateTime createdAt,OffsetDateTime updatedAt,String clientSecret){}
    public record OAuthAuthorizationInfo(String clientId,String name,String redirectUri,Set<String> scopes,boolean publicClient){}
    public record AuthorizationGrant(String redirectUri,String code,String state,Set<String> scopes){}
    public record Token(String accessToken,String tokenType,long expiresIn,String refreshToken,Set<String> scopes){}
    public record Webhook(UUID id,UUID workspaceId,String name,String endpointUrl,Set<String> events,boolean active,int consecutiveFailures,OffsetDateTime suspendedAt,OffsetDateTime createdAt,OffsetDateTime updatedAt,String signingSecret){}
    public record WebhookDelivery(UUID id,UUID webhookId,UUID eventId,String eventType,String status,int attempts,OffsetDateTime nextAttemptAt,Integer responseStatus,String lastError,OffsetDateTime deliveredAt,OffsetDateTime createdAt,OffsetDateTime updatedAt){}
    public record WebhookDeliveryPage(List<WebhookDelivery> items,int nextOffset,boolean hasMore){}
}
