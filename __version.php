<?php
// Version endpoint for deployment tracking
header('Content-Type: application/json');

$git_sha = trim(shell_exec('git rev-parse HEAD 2>/dev/null') ?: 'unknown');
$timestamp = date('Y-m-d H:i:s');
$source_path = 'precogs/precogs-api';

echo json_encode([
    'git_sha' => $git_sha,
    'build_timestamp' => $timestamp,
    'source_identifier' => $source_path,
    'php_version' => phpversion(),
    'deployment_target' => 'PHP Drag System'
]);
?>
