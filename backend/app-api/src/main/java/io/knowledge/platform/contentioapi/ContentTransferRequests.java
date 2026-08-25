package io.knowledge.platform.contentioapi;

import java.util.UUID;

final class ContentTransferRequests {
    private ContentTransferRequests(){}
    record PageExport(UUID pageId,String format,Boolean published){}
    record KnowledgeBaseExport(UUID knowledgeBaseId){}
    record Id(UUID taskId){}
    record ListTasks(Integer limit,Integer offset){}
}
