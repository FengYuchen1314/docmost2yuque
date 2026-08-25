FROM gradle:9.7.0-jdk25 AS build
WORKDIR /source
COPY backend/ ./
RUN gradle --no-daemon :app-api:bootJar :app-worker:bootJar

FROM eclipse-temurin:25-jre-noble AS api
RUN useradd --system --uid 10001 --create-home app
RUN mkdir -p /var/lib/knowledge-platform/attachments && chown -R app:app /var/lib/knowledge-platform
WORKDIR /app
COPY --from=build --chown=app:app /source/app-api/build/libs/knowledge-platform-api.jar /app/application.jar
USER app
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/application.jar"]

FROM eclipse-temurin:25-jre-noble AS worker
RUN useradd --system --uid 10001 --create-home app
WORKDIR /app
COPY --from=build --chown=app:app /source/app-worker/build/libs/knowledge-platform-worker.jar /app/application.jar
USER app
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/application.jar"]
