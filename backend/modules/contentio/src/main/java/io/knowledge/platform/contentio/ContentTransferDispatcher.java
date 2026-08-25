package io.knowledge.platform.contentio;

import java.util.UUID;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class ContentTransferDispatcher {
    private final ContentTransferService service;
    public ContentTransferDispatcher(ContentTransferService service){this.service=service;}

    @Async
    public void dispatch(UUID taskId){run(taskId);}

    @Scheduled(fixedDelayString="${CONTENT_TRANSFER_RECOVERY_DELAY:5000}")
    public void recover(){for(UUID taskId:service.pending(10))run(taskId);}

    private void run(UUID taskId){if(!service.claim(taskId))return;try{service.execute(taskId);}catch(RuntimeException exception){service.fail(taskId,exception);}}
}
