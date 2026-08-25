pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "knowledge-platform-backend"

include(
    "app-api",
    "app-worker",
    "modules:common",
    "modules:authentication",
    "modules:audit",
    "modules:authorization",
    "modules:identity",
    "modules:invitation",
    "modules:jobs",
    "modules:mail",
    "modules:workspace",
    "modules:usergroup",
    "modules:team",
    "modules:knowledgebase",
    "modules:page",
    "modules:catalog",
    "modules:publication",
    "modules:share",
    "modules:engagement",
    "modules:quicknote",
    "modules:collaboration",
    "modules:search",
    "modules:analytics",
    "modules:attachment",
    "modules:template",
    "modules:contentio",
    "modules:social",
    "modules:integration",
    "modules:setup",
)
