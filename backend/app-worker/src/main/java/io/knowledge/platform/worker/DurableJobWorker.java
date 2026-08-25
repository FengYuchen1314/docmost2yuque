package io.knowledge.platform.worker;

import io.knowledge.platform.jobs.JobQueue;
import io.knowledge.platform.jobs.LeasedJob;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
final class DurableJobWorker {

    private static final Duration MAXIMUM_RETRY_DELAY = Duration.ofHours(1);

    private final JobQueue queue;
    private final JobHandlerRegistry handlers;
    private final Clock clock;
    private final String workerId;

    DurableJobWorker(
            JobQueue queue,
            JobHandlerRegistry handlers,
            Clock clock,
            @Value("${worker.id}") String workerId) {
        this.queue = queue;
        this.handlers = handlers;
        this.clock = clock;
        this.workerId = workerId;
    }

    @Scheduled(fixedDelayString = "${worker.poll-delay:250ms}")
    void poll() {
        Optional<LeasedJob> claimed = queue.leaseNext(workerId, OffsetDateTime.now(clock));
        claimed.ifPresent(this::execute);
    }

    private void execute(LeasedJob job) {
        try {
            handlers.require(job.jobType()).handle(job);
            queue.markSucceeded(job.id(), workerId, OffsetDateTime.now(clock));
        } catch (Exception exception) {
            OffsetDateTime now = OffsetDateTime.now(clock);
            queue.markFailed(
                    job.id(),
                    workerId,
                    stackTrace(exception),
                    now.plus(retryDelay(job.attemptCount())),
                    now);
        }
    }

    private static Duration retryDelay(int attempt) {
        long seconds = Math.min(1L << Math.min(attempt, 12), MAXIMUM_RETRY_DELAY.toSeconds());
        return Duration.ofSeconds(seconds);
    }

    private static String stackTrace(Exception exception) {
        StringWriter text = new StringWriter();
        exception.printStackTrace(new PrintWriter(text));
        return text.toString();
    }
}
