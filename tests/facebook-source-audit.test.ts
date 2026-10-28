import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservedFacebookSource } from '../src/infrastructure/browser/facebook-source-audit.js';
const audit={source_url:'https://www.facebook.com/synthetic',observed_url:'https://www.facebook.com/synthetic',source_name:'Synthetic Name',main_text:'Synthetic Name\n3,4K người bạn\nNhắn tin\nThêm bạn bè\nTất cả',at:'2026-10-28T04:00:00Z',document_json_sha256:'synthetic'};
test('actual named source header with friend count and Add Friend proves profile, not User alone',()=>{
  assert.equal(classifyObservedFacebookSource(audit),'PROFILE');
  for(const change of [{main_text:'Synthetic Name\n3,4K người theo dõi\nTheo dõi\nBạn bè'},{main_text:'Different Name\n3,4K người bạn\nThêm bạn bè'},{observed_url:'https://www.facebook.com/login'},{main_text:'Synthetic Name\nUser\nBạn bè'}])assert.equal(classifyObservedFacebookSource({...audit,...change}),'UNKNOWN');
});
