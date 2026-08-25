package io.knowledge.platform.attachment;

import java.io.InputStream;
import org.springframework.core.io.Resource;

interface AttachmentStorage {

    StoredObject store(String storageKey, InputStream input, long maximumBytes);

    Resource load(String storageKey);

    void delete(String storageKey);

    record StoredObject(long sizeBytes, String checksumSha256) {}
}
