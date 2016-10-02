var require = meteorInstall({"imports":{"api":{"tasks.js":["meteor/meteor","meteor/mongo","meteor/check",function(require,exports){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// imports/api/tasks.js                                              //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
exports.__esModule = true;                                           //
exports.Tasks = undefined;                                           //
                                                                     //
var _meteor = require('meteor/meteor');                              // 1
                                                                     //
var _mongo = require('meteor/mongo');                                // 2
                                                                     //
var _check = require('meteor/check');                                // 3
                                                                     //
var Tasks = exports.Tasks = new _mongo.Mongo.Collection('tasks');    // 5
                                                                     //
if (_meteor.Meteor.isServer) {                                       // 7
  _meteor.Meteor.publish("tasks", function () {                      // 8
    function tasksPublication() {                                    // 8
      return Tasks.find({                                            // 9
        $or: [{ 'private': { $ne: true } }, { owner: this.userId }]  // 10
      });                                                            //
    }                                                                //
                                                                     //
    return tasksPublication;                                         //
  }());                                                              //
}                                                                    //
                                                                     //
_meteor.Meteor.methods({                                             // 18
  'tasks.insert': function () {                                      // 19
    function tasksInsert(text) {                                     //
      (0, _check.check)(text, String);                               // 20
                                                                     //
      if (!this.userId) {                                            // 22
        throw new _meteor.Meteor.Error('not-authorized');            // 23
      }                                                              //
      Tasks.insert({                                                 // 25
        text: text,                                                  // 26
        createdAt: new Date(),                                       // 27
        owner: this.userId,                                          // 28
        username: _meteor.Meteor.users.findOne(this.userId).username
      });                                                            //
    }                                                                //
                                                                     //
    return tasksInsert;                                              //
  }(),                                                               //
  'tasks.remove': function () {                                      // 32
    function tasksRemove(taskId) {                                   //
      (0, _check.check)(taskId, String);                             // 33
                                                                     //
      var task = Tasks.findOne(taskId);                              // 35
      if (task['private'] && task.owner !== this.userId) {           // 36
        throw new _meteor.Meteor.Error('not-authorized');            // 37
      }                                                              //
                                                                     //
      Tasks.remove(taskId);                                          // 40
    }                                                                //
                                                                     //
    return tasksRemove;                                              //
  }(),                                                               //
  'tasks.setChecked': function () {                                  // 42
    function tasksSetChecked(taskId, setChecked) {                   //
      (0, _check.check)(taskId, String);                             // 43
      (0, _check.check)(setChecked, Boolean);                        // 44
                                                                     //
      var task = Tasks.findOne(taskId);                              // 46
      if (task['private'] && task.owner !== this.userId) {           // 47
        throw new _meteor.Meteor.Error('not-authorized');            // 48
      }                                                              //
                                                                     //
      Tasks.update(taskId, {                                         // 51
        $set: { checked: setChecked }                                // 52
      });                                                            //
    }                                                                //
                                                                     //
    return tasksSetChecked;                                          //
  }(),                                                               //
  'tasks.setPrivate': function () {                                  // 55
    function tasksSetPrivate(taskId, setToPrivate) {                 //
      (0, _check.check)(taskId, String);                             // 56
      (0, _check.check)(setToPrivate, Boolean);                      // 57
                                                                     //
      var task = Tasks.findOne(taskId);                              // 59
      if (task.owner !== this.userId) {                              // 60
        throw new _meteor.Meteor.Error('not-authorized');            // 61
      }                                                              //
      Tasks.update(taskId, { $set: { 'private': setToPrivate } });   // 63
    }                                                                //
                                                                     //
    return tasksSetPrivate;                                          //
  }()                                                                //
});                                                                  //
///////////////////////////////////////////////////////////////////////

}]}},"server":{"main.js":["meteor/meteor","../imports/api/tasks.js",function(require){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// server/main.js                                                    //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
var _meteor = require('meteor/meteor');                              // 1
                                                                     //
require('../imports/api/tasks.js');                                  // 3
                                                                     //
_meteor.Meteor.startup(function () {                                 // 5
  // code to run on server at startup                                //
});                                                                  //
///////////////////////////////////////////////////////////////////////

}]}},{"extensions":[".js",".json"]});
require("./server/main.js");
//# sourceMappingURL=app.js.map
