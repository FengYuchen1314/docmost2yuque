package io.knowledge.platform.invitation;

import java.util.List;

public record InvitationPageView(
        List<InvitationView> items,
        int nextOffset,
        boolean hasMore) {}
