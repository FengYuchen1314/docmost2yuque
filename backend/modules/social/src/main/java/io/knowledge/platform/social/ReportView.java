package io.knowledge.platform.social;
import java.time.OffsetDateTime;import java.util.UUID;
public record ReportView(UUID id,UUID reporterId,String targetType,UUID targetId,String reason,String details,String status,UUID reviewedBy,OffsetDateTime reviewedAt,String resolution,OffsetDateTime createdAt) {}
