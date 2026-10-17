import assert from 'node:assert/strict';
import test from 'node:test';
import {sanitizeUpdateError} from '../tavern-plugin/lib/application-updater.js';
test('Windows 子进程退出错误不会被局部乱码掩盖',()=>{
 assert.match(sanitizeUpdateError('Done in 11.9s\nPostQueuedCompletionStatus: (6) �����\npnpm 执行失败'),/PostQueuedCompletionStatus.*6/);
});
