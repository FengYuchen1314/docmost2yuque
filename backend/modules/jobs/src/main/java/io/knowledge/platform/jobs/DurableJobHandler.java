package io.knowledge.platform.jobs;

public interface DurableJobHandler {

    String jobType();

    void handle(LeasedJob job) throws Exception;
}
