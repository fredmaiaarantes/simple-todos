import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { assert } from 'meteor/practicalmeteor:chai';

import { Tasks } from './tasks.js';

if(Meteor.isServer){
  describe('Tasks', ()=> {
    describe('methods', ()=> {

      const userId = Random.id();
      let taskId;
      beforeEach(()=> {
        Tasks.remove({});
        taskId = Tasks.insert({
          text: 'test task',
          createdAt: new Date(),
          private: true,
          owner: userId,
          username: 'tmeasday'
        });
      });

      it('can delete owned task', () =>{
        //Find the internal implementation of the task method so we
        //can test it in isolation
        const deleteTask = Meteor.server.method_handlers['tasks.remove'];
        const invocation = { userId };
        deleteTask.apply(invocation, [taskId]);
        assert.equal(Tasks.find().count(), 0);
      });

      // it('cant delete task of other user', () =>{
      //   const anotherUserId = Random.id();
      //   const deleteTask = Meteor.server.method_handlers['tasks.remove'];
      //   const invocation = { anotherUserId };
      //   deleteTask.apply(invocation, [taskId]);
      //   assert.equal(Tasks.find().count(), 1);
      // });
    });
  });
}
