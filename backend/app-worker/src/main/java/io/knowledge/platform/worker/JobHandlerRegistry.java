package io.knowledge.platform.worker;

import io.knowledge.platform.jobs.DurableJobHandler;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
final class JobHandlerRegistry {

    private final Map<String, DurableJobHandler> handlers;

    JobHandlerRegistry(List<DurableJobHandler> handlers) {
        this.handlers = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        DurableJobHandler::jobType,
                        Function.identity(),
                        (left, right) -> {
                            throw new IllegalStateException(
                                    "Duplicate durable job handler: " + left.jobType());
                        }));
    }

    DurableJobHandler require(String jobType) {
        DurableJobHandler handler = handlers.get(jobType);
        if (handler == null) {
            throw new IllegalStateException("No durable job handler is registered for " + jobType);
        }
        return handler;
    }
}
