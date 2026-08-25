package io.knowledge.platform.search;

import io.knowledge.platform.authorization.AuthorizationService;
import io.knowledge.platform.authorization.Capability;
import io.knowledge.platform.authorization.ResourceNotFoundException;
import io.knowledge.platform.authorization.ResourceType;
import io.knowledge.platform.common.DomainConflictException;
import io.knowledge.platform.common.Ids;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SearchRebuildService {
    private static final List<String> PHASES=List.of("KNOWLEDGE_BASE","TEAM","PAGE","QUICK_NOTE","TEMPLATE","ATTACHMENT","PUBLICATION","CLEANUP");
    private final SearchRebuildRepository repository;private final SearchIndexWriter writer;private final AuthorizationService authorization;private final Clock clock;
    public SearchRebuildService(SearchRebuildRepository repository,SearchIndexWriter writer,AuthorizationService authorization,Clock clock){this.repository=repository;this.writer=writer;this.authorization=authorization;this.clock=clock;}
    @Transactional public SearchRebuildView start(UUID actor,UUID workspaceId){authorization.require(actor,ResourceType.WORKSPACE,workspaceId,Capability.MANAGE);UUID id=Ids.next();try{repository.insert(id,workspaceId,actor,now());}catch(DuplicateKeyException e){throw new DomainConflictException("SEARCH_REBUILD_ACTIVE","A search rebuild is already active for this workspace");}return require(id,false);}
    @Transactional public SearchRebuildView advance(UUID actor,UUID id,int requestedBatch){SearchRebuildView job=require(id,true);authorization.require(actor,ResourceType.WORKSPACE,job.workspaceId(),Capability.MANAGE);if("PAUSED".equals(job.status())||"SUCCEEDED".equals(job.status())||"FAILED".equals(job.status()))return job;if(!"RUNNING".equals(job.status()))throw new DomainConflictException("SEARCH_REBUILD_STATE","Search rebuild is not runnable");int batch=Math.max(1,Math.min(requestedBatch,500));try{String phase=job.cursorType();if("CLEANUP".equals(phase)){long removed=repository.cleanup(job.workspaceId());repository.progress(id,"DONE",null,job.processedCount()+removed,now());repository.status(id,"SUCCEEDED",now(),true);return require(id,false);}List<SearchDocumentCommand> commands=repository.batch(phase,job.workspaceId(),job.cursorId(),batch);for(SearchDocumentCommand command:commands)writer.upsert(command);long processed=job.processedCount()+commands.size();if(commands.size()<batch){phase=PHASES.get(PHASES.indexOf(phase)+1);repository.progress(id,phase,null,processed,now());}else repository.progress(id,phase,commands.get(commands.size()-1).id(),processed,now());return require(id,false);}catch(RuntimeException e){String message=e.getMessage()==null?"Search rebuild failed":e.getMessage();repository.failed(id,job.errorCount()+1,message.substring(0,Math.min(1000,message.length())),now());return require(id,false);}}
    @Transactional public SearchRebuildView pause(UUID actor,UUID id){SearchRebuildView job=require(id,true);authorization.require(actor,ResourceType.WORKSPACE,job.workspaceId(),Capability.MANAGE);if("RUNNING".equals(job.status()))repository.status(id,"PAUSED",now(),false);return require(id,false);}
    @Transactional public SearchRebuildView resume(UUID actor,UUID id){SearchRebuildView job=require(id,true);authorization.require(actor,ResourceType.WORKSPACE,job.workspaceId(),Capability.MANAGE);if("PAUSED".equals(job.status()))repository.status(id,"RUNNING",now(),false);return require(id,false);}
    @Transactional(readOnly=true) public SearchRebuildView get(UUID actor,UUID id){SearchRebuildView job=require(id,false);authorization.require(actor,ResourceType.WORKSPACE,job.workspaceId(),Capability.MANAGE);return job;}
    @Transactional(readOnly=true) public List<SearchRebuildView> list(UUID actor,UUID workspaceId){authorization.require(actor,ResourceType.WORKSPACE,workspaceId,Capability.MANAGE);return repository.list(workspaceId);}
    @Transactional(readOnly=true) public SearchRebuildPageView page(UUID actor,UUID workspaceId,int limit,int offset){authorization.require(actor,ResourceType.WORKSPACE,workspaceId,Capability.MANAGE);int count=Math.max(1,Math.min(limit,100));int start=Math.max(0,offset);List<SearchRebuildView> rows=repository.list(workspaceId,count+1,start);boolean hasMore=rows.size()>count;List<SearchRebuildView> items=List.copyOf(rows.subList(0,Math.min(rows.size(),count)));return new SearchRebuildPageView(items,start+items.size(),hasMore);}
    private SearchRebuildView require(UUID id,boolean lock){SearchRebuildView value=repository.find(id,lock);if(value==null)throw new ResourceNotFoundException();return value;}private OffsetDateTime now(){return OffsetDateTime.now(clock);}
}
