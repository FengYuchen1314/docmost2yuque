package io.knowledge.platform.templateapi;

import java.util.UUID;

final class TemplateRequests {
    private TemplateRequests() {}
    record SaveDocument(UUID pageId,String name,String description,String category,String thumbnail,String visibility){}
    record SaveKnowledgeBase(UUID knowledgeBaseId,String name,String description,String category,String thumbnail,String visibility){}
    record ListTemplates(UUID workspaceId,String templateType,String query,Integer limit,Integer offset){}
    record Id(UUID templateId){}
    record InstantiateDocument(UUID templateId,UUID knowledgeBaseId,String title,String path){}
    record InstantiateKnowledgeBase(UUID templateId,UUID workspaceId,String name,String slug){}
}
