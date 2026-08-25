package io.knowledge.platform.page;

import java.util.List;
import java.util.UUID;

public record PollStateView(
        UUID cardInstanceId,
        long totalVoters,
        List<OptionResult> options,
        List<String> selectedOptionIds,
        boolean closed) {

    public record OptionResult(String id, String label, long votes) {}
}
