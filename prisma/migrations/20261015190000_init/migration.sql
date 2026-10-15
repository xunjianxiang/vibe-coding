-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(64) NOT NULL,
    `sub` VARCHAR(255) NOT NULL,
    `token_enc` LONGTEXT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sessions_sub_idx`(`sub`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(36) NOT NULL,
    `key` VARCHAR(255) NOT NULL,
    `path` TEXT NOT NULL,
    `status` ENUM('DISCOVERING', 'READY', 'INVALID', 'MISSING') NOT NULL DEFAULT 'DISCOVERING',
    `error` TEXT NULL,
    `devcontainer_hash` CHAR(64) NULL,
    `seen_at` DATETIME(3) NOT NULL,
    `checked_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `projects_key_key`(`key`),
    INDEX `projects_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leases` (
    `project_id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NULL,
    `sub` VARCHAR(255) NOT NULL,
    `state` ENUM('CLAIMED', 'DEVELOPING') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `leases_workspace_id_key`(`workspace_id`),
    INDEX `leases_sub_idx`(`sub`),
    PRIMARY KEY (`project_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspaces` (
    `id` VARCHAR(36) NOT NULL,
    `project_id` VARCHAR(36) NOT NULL,
    `sub` VARCHAR(255) NOT NULL,
    `request_id` VARCHAR(255) NOT NULL,
    `path` TEXT NOT NULL,
    `status` ENUM('PENDING', 'CREATING', 'STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'DELETING', 'DELETED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `container_id` VARCHAR(255) NULL,
    `container_state` VARCHAR(32) NULL,
    `container_observed_at` DATETIME(3) NULL,
    `container_started_at` DATETIME(3) NULL,
    `container_stopped_at` DATETIME(3) NULL,
    `container_exit_code` INTEGER NULL,
    `container_stop_reason` ENUM('REQUESTED', 'NORMAL_EXIT', 'PROCESS_ERROR', 'OOM', 'UNKNOWN') NULL,
    `container_oom_detected` BOOLEAN NOT NULL DEFAULT false,
    `desired_state` ENUM('RUNNING', 'STOPPED', 'DELETED') NOT NULL DEFAULT 'RUNNING',
    `version` INTEGER NOT NULL DEFAULT 1,
    `error` TEXT NULL,
    `devcontainer_hash` CHAR(64) NULL,
    `active_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `active_terminal_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `workspaces_status_desired_state_idx`(`status`, `desired_state`),
    INDEX `workspaces_sub_idx`(`sub`),
    INDEX `workspaces_active_terminal_id_idx`(`active_terminal_id`),
    UNIQUE INDEX `workspaces_project_id_sub_request_id_key`(`project_id`, `sub`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `terminals` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `sub` VARCHAR(255) NOT NULL,
    `kind` ENUM('SHELL', 'AGENT') NOT NULL,
    `agent` ENUM('CODEX') NULL,
    `title` VARCHAR(128) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `desired_state` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,

    INDEX `terminals_workspace_id_desired_state_idx`(`workspace_id`, `desired_state`),
    INDEX `terminals_sub_idx`(`sub`),
    UNIQUE INDEX `terminals_workspace_id_sequence_key`(`workspace_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `terminal_runtimes` (
    `id` VARCHAR(36) NOT NULL,
    `terminal_id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `container_id` VARCHAR(255) NOT NULL,
    `exec_id` VARCHAR(255) NULL,
    `active_key` VARCHAR(36) NULL,
    `status` ENUM('STARTING', 'RUNNING', 'STOPPING', 'INTERRUPTED', 'EXITED', 'ERROR') NOT NULL DEFAULT 'STARTING',
    `last_activity_at` DATETIME(3) NOT NULL,
    `idle_expires_at` DATETIME(3) NOT NULL,
    `exit_code` INTEGER NULL,
    `error` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,

    UNIQUE INDEX `terminal_runtimes_active_key_key`(`active_key`),
    INDEX `terminal_runtimes_workspace_id_status_idle_expires_at_idx`(`workspace_id`, `status`, `idle_expires_at`),
    INDEX `terminal_runtimes_terminal_id_started_at_idx`(`terminal_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `runner_health` (
    `id` VARCHAR(64) NOT NULL,
    `docker_status` ENUM('HEALTHY', 'UNREACHABLE') NOT NULL DEFAULT 'UNREACHABLE',
    `event_stream_connected` BOOLEAN NOT NULL DEFAULT false,
    `checked_at` DATETIME(3) NOT NULL,
    `error` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_operations` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `service_id` VARCHAR(64) NOT NULL,
    `action` ENUM('RESTART') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `requested_by` VARCHAR(255) NOT NULL,
    `idempotency_key` VARCHAR(255) NOT NULL,
    `active_key` VARCHAR(64) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `service_operations_status_created_at_idx`(`status`, `created_at`),
    UNIQUE INDEX `service_operations_workspace_id_idempotency_key_key`(`workspace_id`, `idempotency_key`),
    UNIQUE INDEX `service_operations_workspace_id_active_key_key`(`workspace_id`, `active_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ports` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `container_id` VARCHAR(255) NOT NULL,
    `container_port` INTEGER NOT NULL,
    `host_ip` VARCHAR(64) NOT NULL,
    `host_port` INTEGER NOT NULL,
    `proto` VARCHAR(16) NOT NULL,
    `url` TEXT NULL,
    `status` ENUM('PUBLISHED', 'WAITING', 'AVAILABLE') NOT NULL DEFAULT 'PUBLISHED',
    `checked_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ports_workspace_id_container_id_container_port_host_port_key`(`workspace_id`, `container_id`, `container_port`, `host_port`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `resources` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `type` ENUM('CONTAINER', 'VOLUME', 'NETWORK') NOT NULL,
    `docker_id` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NULL,
    `compose_project` VARCHAR(255) NULL,
    `labels` JSON NULL,
    `retention` ENUM('TEMPORARY', 'PERSISTENT') NOT NULL DEFAULT 'TEMPORARY',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `resources_compose_project_idx`(`compose_project`),
    UNIQUE INDEX `resources_workspace_id_type_docker_id_key`(`workspace_id`, `type`, `docker_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `codex_sessions` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `terminal_id` VARCHAR(36) NULL,
    `runtime_id` VARCHAR(36) NULL,
    `native_session_id` VARCHAR(255) NULL,
    `sub` VARCHAR(255) NOT NULL,
    `exec_id` VARCHAR(255) NULL,
    `status` ENUM('STARTING', 'RUNNING', 'INTERRUPTED', 'EXITED', 'ERROR') NOT NULL DEFAULT 'STARTING',
    `exit_code` INTEGER NULL,
    `error` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `connected_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,

    UNIQUE INDEX `codex_sessions_runtime_id_key`(`runtime_id`),
    INDEX `codex_sessions_workspace_id_status_idx`(`workspace_id`, `status`),
    INDEX `codex_sessions_terminal_id_started_at_idx`(`terminal_id`, `started_at`),
    INDEX `codex_sessions_terminal_id_native_session_id_idx`(`terminal_id`, `native_session_id`),
    INDEX `codex_sessions_sub_idx`(`sub`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `leases` ADD CONSTRAINT `leases_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `terminals` ADD CONSTRAINT `terminals_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `terminal_runtimes` ADD CONSTRAINT `terminal_runtimes_terminal_id_fkey` FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `terminal_runtimes` ADD CONSTRAINT `terminal_runtimes_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_operations` ADD CONSTRAINT `service_operations_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ports` ADD CONSTRAINT `ports_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `resources` ADD CONSTRAINT `resources_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `codex_sessions` ADD CONSTRAINT `codex_sessions_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `codex_sessions` ADD CONSTRAINT `codex_sessions_terminal_id_fkey` FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `codex_sessions` ADD CONSTRAINT `codex_sessions_runtime_id_fkey` FOREIGN KEY (`runtime_id`) REFERENCES `terminal_runtimes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
