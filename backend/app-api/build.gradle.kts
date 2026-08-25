plugins {
    java
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
}

dependencyManagement {
    imports {
        mavenBom("org.springframework.modulith:spring-modulith-bom:2.1.0")
    }
}

dependencies {
    implementation(project(":modules:common"))
    implementation(project(":modules:authentication"))
    implementation(project(":modules:audit"))
    implementation(project(":modules:authorization"))
    implementation(project(":modules:identity"))
    implementation(project(":modules:invitation"))
    implementation(project(":modules:mail"))
    implementation(project(":modules:workspace"))
    implementation(project(":modules:usergroup"))
    implementation(project(":modules:team"))
    implementation(project(":modules:knowledgebase"))
    implementation(project(":modules:page"))
    implementation(project(":modules:catalog"))
    implementation(project(":modules:publication"))
    implementation(project(":modules:share"))
    implementation(project(":modules:engagement"))
    implementation(project(":modules:quicknote"))
    implementation(project(":modules:collaboration"))
    implementation(project(":modules:search"))
    implementation(project(":modules:analytics"))
    implementation(project(":modules:attachment"))
    implementation(project(":modules:template"))
    implementation(project(":modules:contentio"))
    implementation(project(":modules:social"))
    implementation(project(":modules:integration"))
    implementation(project(":modules:setup"))

    implementation(libs.spring.boot.webmvc)
    implementation(libs.spring.boot.validation)
    implementation(libs.spring.boot.security)
    implementation(libs.spring.boot.jooq)
    implementation(libs.spring.boot.actuator)
    implementation(libs.spring.modulith.starter.core)
    implementation(libs.spring.boot.flyway)
    implementation(libs.flyway.postgresql)
    implementation(libs.bouncycastle.provider)
    runtimeOnly(libs.postgresql)

    testImplementation(libs.spring.boot.test)
    testImplementation(libs.spring.security.test)
    testImplementation(libs.spring.modulith.starter.test)
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.testcontainers.junit)
}

tasks.bootJar {
    archiveFileName = "knowledge-platform-api.jar"
}
