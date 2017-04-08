"use strict";

exports.__esModule = true;

var _classCallCheck2 = require("babel-runtime/helpers/classCallCheck");

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var Library = function () {
  function Library() {
    var props = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    (0, _classCallCheck3.default)(this, Library);

    this.id = props.id;
  }

  Library.prototype.foo = function foo() {
    return "foo " + this.id;
  };

  return Library;
}();

exports.default = Library;
//# sourceMappingURL=Library.js.map