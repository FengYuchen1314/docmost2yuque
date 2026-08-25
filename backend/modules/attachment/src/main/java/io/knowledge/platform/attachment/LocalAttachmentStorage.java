package io.knowledge.platform.attachment;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Component;

@Component
final class LocalAttachmentStorage implements AttachmentStorage {

    private final Path root;

    LocalAttachmentStorage(
            @Value("${platform.storage.local-root:/var/lib/knowledge-platform/attachments}")
            String rootValue) {
        this.root = Path.of(rootValue).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException exception) {
            throw new IllegalStateException("Attachment storage cannot be initialized", exception);
        }
    }

    @Override
    public StoredObject store(String storageKey, InputStream input, long maximumBytes) {
        Path target = resolve(storageKey);
        Path parent = target.getParent();
        Path temporary = null;
        try {
            Files.createDirectories(parent);
            temporary = Files.createTempFile(parent, ".upload-", ".tmp");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (OutputStream output = new DigestOutputStream(
                    Files.newOutputStream(temporary), digest)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read == 0) continue;
                    total += read;
                    if (total > maximumBytes) {
                        throw new IllegalArgumentException("Attachment exceeds the maximum file size");
                    }
                    output.write(buffer, 0, read);
                }
            }
            if (total == 0) throw new IllegalArgumentException("Attachment cannot be empty");
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporary, target);
            }
            return new StoredObject(total, HexFormat.of().formatHex(digest.digest()));
        } catch (IOException exception) {
            throw new IllegalStateException("Attachment could not be stored", exception);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // The operating system will clean an abandoned temporary file later.
                }
            }
        }
    }

    @Override
    public Resource load(String storageKey) {
        Path path = resolve(storageKey);
        if (!Files.isRegularFile(path)) {
            throw new io.knowledge.platform.authorization.ResourceNotFoundException();
        }
        return new FileSystemResource(path);
    }

    @Override
    public void delete(String storageKey) {
        try {
            Files.deleteIfExists(resolve(storageKey));
        } catch (IOException exception) {
            throw new IllegalStateException("Attachment could not be deleted", exception);
        }
    }

    private Path resolve(String storageKey) {
        if (storageKey == null || storageKey.isBlank()) {
            throw new IllegalArgumentException("Attachment storage key is required");
        }
        Path resolved = root.resolve(storageKey).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalArgumentException("Attachment storage key escapes the storage root");
        }
        return resolved;
    }
}
