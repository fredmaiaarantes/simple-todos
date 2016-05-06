import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { ReactiveDict } from 'meteor/reactive-dict';
import { Tasks } from '../api/tasks.js';
import './body.html';
import './task.js';

Template.body.onCreated(function bodyOnCreatead() {
  this.state = new ReactiveDict();
  Meteor.subscribe("tasks");
});

Template.body.helpers({
  tasks() {
    const instance = Template.instance();
    const sort = { sort: { createdAt: -1 } };
    if(instance.state.get('hideCompleted')) {
      return Tasks.find({}, { sort: { createdAt: -1 } });
    }
    return Tasks.find({}, sort);
  },
  incompleteCount() {
    return Tasks.find({ checked: { $ne: true }}).count();
  }
});

Template.body.events({
  "submit .new-task": function(event){
     event.preventDefault();

     const target = event.target;
     const text = target.text.value;

     Meteor.call('tasks.insert', text);
     target.text.value = '';
  },
  "change .hide-completed input"(event, instance){
    instance.state.set('hideCompleted', event.target.checked);
  }
});
