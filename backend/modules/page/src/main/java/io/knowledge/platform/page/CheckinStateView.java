package io.knowledge.platform.page;

import java.time.LocalDate;
import java.util.UUID;

public record CheckinStateView(
        UUID cardInstanceId,
        LocalDate localDate,
        long totalParticipants,
        long todayCount,
        boolean checkedIn) {}
