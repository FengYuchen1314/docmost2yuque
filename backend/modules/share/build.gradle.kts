plugins {
    java
    `java-library`
    alias(libs.plugins.spring.dependency.management)
}

dependencyManagement {
    imports {
        mavenBom(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES)
    }
}

dependencies {
    api(project(":modules:common"))
    implementation(project(":modules:audit"))
    implementation(project(":modules:authorization"))
    implementation(project(":modules:publication"))
    implementation(project(":modules:analytics"))
    implementation(project(":modules:engagement"))
    implementation(project(":modules:workspace"))
    implementation(libs.jackson.databind)
    implementation(libs.spring.context)
    implementation(libs.spring.tx)
    implementation(libs.spring.security.crypto)
    implementation(libs.jooq)

    testImplementation(libs.spring.boot.test)
}
