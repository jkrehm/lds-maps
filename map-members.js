(function ($, global) {

    // Utility functions
    var Utilities = {

        buildURL : function (route) {

            var LDS_URL = 'https://www.lds.org/directory/services/ludrs/';

            var routes = {
                'household'   : 'mem/householdProfile/#{param}',
                'member-list' : 'mem/member-list/#{param}',
                'stake-info'  : 'unit/current-user-units/',
                'ward-info'   : 'unit/current-user-ward-stake/',
            };

            return LDS_URL + routes[route];
        },
    };


    // Event manager
    function EventManager () {
        this.events = [];
    }

    EventManager.prototype = {

        on : function (e, callback) {

            this.events[e] = this.events[e] || [];

            this.events[e].push(callback);

            return this;
        },

        trigger : function () {

            var args = Array.prototype.slice.call(arguments);
            var e = args.splice(0, 1)[0]; // First parameter will be the event name
            var events = this.events[e];

            if (events instanceof Array) {
                events.forEach(function (callback) {
                    callback.apply(this, args);
                }, this);
            }

            return this;
        },
    };


    // Request manager (extends EventManager)
    function RequestManager (throttle) {
        this.requests = [];
        this.events = [];
        this.status = 'stopped';
        this.timer = 0;
        this.throttle = throttle || 20;
    }

    $.extend(RequestManager.prototype, EventManager.prototype, {

        push : function (request) {

            var deferred = $.Deferred();

            this.requests.push({
                request  : request,
                deferred : deferred,
                status   : 'pending',
            });

            if (!this.isRunning()) {
                this.startQueue();
            }

            return deferred.promise();
        },

        startQueue : function () {

            var self = this;

            // Only start the queue if it's not actively running
            if (this.isRunning()) {
                return;
            }

            this.status = 'running';
            this.trigger('queue:starting');

            // Resolve the request with ajax response
            function resolveRequest (r) {

                var self = this;

                return function (response) {

                    // If this is the last request, stop queue
                    if (self.isQueueClear()) {
                        self.stopQueue();
                    }

                    r.status = 'done';
                    r.deferred.resolve(response);
                };
            }

            // Process requests - up to the throttle limit - checking for more every 1/2 second
            this.timer = setInterval(function () {

                // If queue is not stopped by last request's return, stop here
                if (self.isQueueClear()) {
                    self.stopQueue();
                }

                // Send requests
                _.each(
                    _.first(
                        _.where(self.requests, {status : 'pending'}
                    ), self.throttle),
                function (r) {
                    $.ajax(r.request).done(resolveRequest.call(self, r));
                    r.status = 'running';
                });

            }, 500);

            return this;
        },

        stopQueue : function () {

            var self = this;

            if (!this.isRunning()) {
                return this;
            }

            clearInterval(self.timer);

            self.status = 'stopped';
            self.trigger('queue:stopped');

            return this;
        },

        isRunning : function () {
            return (this.status === 'running');
        },

        isQueueClear : function () {
            return (_.filter(this.requests, function (r) {
                return ['pending', 'running'].indexOf(r.status) > -1;
            }).length === 0);
        }
    });


    // Dialog box
    function Dialog (text) {
        this.text = text;
    }

    Dialog.prototype = {

        setText : function(text) {

            this.text = text;
            this.$html.text(this.text);

            return this;
        },

        show : function(selector) {

            if (typeof selector === 'undefined') {
                selector = '#map-canvas';
            }

            this.$html = $('<div/>', {'class' : 'map-dialog'})
                .text(this.text)
                .appendTo(selector)
                .fadeIn();

            return this;
        },

        hide : function() {

            this.$html.fadeOut();

            return this;
        },

        close : function() {

            this.$html.fadeOut(function () {
                $(this).remove();
            });

            return this;
        },
    };


    // Map Region
    function Region (map, latLng, eventManager) {

        var self = this;
        var offset = 0.02;
        var ne = new google.maps.LatLng(latLng.lat() + offset, latLng.lng() + offset);
        var sw = new google.maps.LatLng(latLng.lat() - offset, latLng.lng() - offset);

        this.map = map;
        this.eventManager = eventManager;
        this.bounds = new google.maps.LatLngBounds(sw, ne);

        var boundaries = new google.maps.Rectangle({
            bounds    : this.bounds,
            draggable : true,
            editable  : true,
            map       : this.map,
        });

        // Trigger change
        this.eventManager.trigger('change:region', this);

        // Handle boundary changes
        function boundsChanged () {
            self.bounds = this.getBounds();
            self.eventManager.trigger('change:region', self);
        }

        google.maps.event.addListener(boundaries, 'bounds_changed', _.throttle(boundsChanged, 100));
    }

    Region.prototype = {

        getRegion : function () {
            return this.bounds;
        },
    };


    // Views
    function View (options) {

        options = _.extend({}, {
            attributes : {},
            tagName    : 'div',
            template   : '',
        }, options);

        this.$el = $('<' + options.tagName + '>').attr(options.attributes);
        this.el = this.$el[0];

        this.template = options.template;
    }

    function SelectView (options) {

        options = _.extend({}, {
            data     : [],
            selected : '',
        }, options);

        this.data = options.data;
        this.selected = options.selected;

        View.prototype.constructor.apply(this, arguments);
    }

    $.extend(SelectView.prototype, View.prototype, {

        render : function () {

            var html;
            var template = _.template(this.template);

            this.data.forEach(function (item) {
                html = template(_.extend({}, item, {selected : this.selected}));
                this.$el.append(html);
            }, this);

            return this;
        },
    });


    // Scripts and styles
    function loadScripts () {

        var isMapsLoaded = $.Deferred();

        // If Google Maps hasn't loaded, load now and what it's finished, resolve the Deferred
        if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
            $.getScript('//maps.googleapis.com/maps/api/js?sensor=false&callback=mapsLoaded');

            global.mapsLoaded = function () {
                isMapsLoaded.resolve();
            };

        } else {
            $('#map-members').empty();
            isMapsLoaded.resolve();
        }

        // When dependencies have loaded, kick things off
        $.when(
            isMapsLoaded,
            $.getScript('//cdnjs.cloudflare.com/ajax/libs/lodash.js/2.4.1/lodash.min.js')
        ).done(initialize);
    }

    function addStyles () {

        var styles = [
            'body {',
            'overflow: hidden;',
            '}',

            '#map-canvas, #member-filters, #members-list, .map-dialog {',
            'box-sizing: border-box',
            '}',


            '#map-canvas, #member-filters, #members-list {',
            'box-sizing: border-box;',
            'position: absolute;',
            'z-index: 9999;',
            '}',

            '#map-canvas, #members-list {',
            'bottom: 10px;',
            '}',

            '#map-canvas {',
            'left: 10px;',
            'margin-right: 5px;',
            'right: 20%;',
            'top: 10px;',
            '}',

            '#member-filters, #members-list {',
            'background-color: #fafafa;',
            'color: #777;',
            'left: 80%;',
            'margin-left: 5px;',
            'padding: 5px;',
            'right: 10px;',
            '}',

            '#member-filters {',
            'height: 40px;',
            'top: 10px;',
            '}',

            '#member-filters > label {',
            'line-height: 30px;',
            'margin: 0 5px;',
            '}',

            '#members-list {',
            'background-position: 50%;',
            'background-repeat: no-repeat;',
            'overflow: auto;',
            'top: 60px;',
            '}',

            '#members-list > div {',
            'margin: 5px;',
            '}',

            '.map-dialog {',
            'background: #3c3c3c;',
            'border: 2px solid #000;',
            'color: #f0f0f0;',
            'display: none;',
            'left: 50%;',
            'margin-left: -150px;',
            'padding: 30px 40px;',
            'pointer-events: none;',
            'position: absolute;',
            'text-align: center;',
            'top: 10px;',
            'width: 400px;',
            'z-index: 1;',
            '}',
        ];

        var s = document.createElement('style');
        s.type = 'text/css';
        s.innerHTML = styles.join(' ');
        s.appendChild(document.createTextNode('')); // webkit hack
        document.head.appendChild(s);
    }

    // Load 3rd party scripts and apply styles
    loadScripts();




    /*** MAIN APPLICATION ***/

    function initialize () {

        var $mapMembers = $('<div/>', {id : '#map-members'}).prependTo('body');
        var eventManager = new EventManager();

        addStyles();
        initializeMap($mapMembers, eventManager);
        getMembership($mapMembers, eventManager);

        // When ward changes, re-initialize the map
        eventManager.on('change:ward', function () {
            initializeMap($mapMembers, eventManager);
        });
    }

    function initializeMap ($mapMembers, eventManager) {

        function makeMap (location) {

            var map = new google.maps.Map(document.getElementById('map-canvas'), {
                center  : new google.maps.LatLng(location.coords.latitude, location.coords.longitude),
                zoom    : 13,
            });

            map.regions = [];

            // Show helper dialog
            var dialog = new Dialog('Use your mouse place the ward boundaries').show($mapCanvas);

            var clickListener = google.maps.event.addListener(map, 'click', function (e) {
                dialog.close();
                map.regions.push(new Region(map, e.latLng, eventManager));

                google.maps.event.removeListener(clickListener); //@todo Union multiple regions
            });

            // When the ward changes, remove all regions
            eventManager.on('change:ward', function () {
                while (map.regions.length > 0) {
                    map.regions.pop();
                }
            });
        }

        var $mapCanvas = $('<div/>', {id : 'map-canvas'}).appendTo($mapMembers);

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(makeMap);
        } else {
            alert('Your browser doesn\'t support geolocation');
        }

        // When ward changes, clear the map
        eventManager.on('change:ward', function () {
            $mapCanvas.remove();
        });
    }

    function getMembership ($mapMembers, eventManager) {

        function getWard () {
            $.getJSON(Utilities.buildURL('ward-info'))
                .done(getStake)
                .done(getMembers);
        }

        function getStake (response) {

            var url = Utilities.buildURL('stake-info');

            $.getJSON(url).done(function (r) {
                showWardsFilter(response.wardUnitNo, r);
            });
        }

        function showWardsFilter (ward, response) {

            response = response[0];

            var wardsView = new SelectView({
                template   : '<option value="<%= wardUnitNo %>" <% if (wardUnitNo === selected) { %> selected <% } %>><%= wardName %></option>',
                tagName    : 'select',
                attributes : {
                    name : 'ward-filter',
                },
                data       : response.wards,
                selected   : ward,
            });

            $memberFilters.append(wardsView.render().el);

            // Selected ward changed
            wardsView.$el.on('change', function (e) {

                var ward = $(e.target).val();

                // Trigger any event listeners
                eventManager.trigger('change:ward', ward);

                getMembers({wardUnitNo : ward});
            });
        }

        function getMembers (response) {

            var ward = response.wardUnitNo;
            var url = Utilities.buildURL('member-list').replace(/#{param}/, ward);

            $members.empty();

            $.getJSON(url).done(getHouseholds);
        }

        function getHouseholds (response) {

            var url = Utilities.buildURL('household');
            var members = [];

            // Show loader on start and hide on finish
            var requestManager = new RequestManager()
                .on('queue:starting', function () {

                    $members.css({
                        'background-image' : 'url("https://www.lds.org/directory/images/spinner-46x46.gif")',
                        'color'            : '#cfcfcf',
                    });

                })
                .on('queue:stopped', _.debounce(function () {

                    $members.css({
                        'background-image' : '',
                        'color'            : '',
                    });

                }, 1000))
                .on('queue:stopped', _.debounce(function () {
                    return showMembers(members);
                }, 1000));


            // Get members' names and addresses
            response.forEach(function (hh) {

                var id = hh.headOfHouseIndividualId;
                var household = {
                    name   : hh.coupleName,
                    MALE   : {name : ''},
                    FEMALE : {name : ''},
                };

                household[hh.headOfHouse.gender] = hh.headOfHouse.preferredName;

                if (hh.spouse.preferredName.length > 0) {
                    household[hh.spouse.gender] = hh.spouse.preferredName;
                }

                requestManager.push({

                    type     : 'GET',
                    dataType : 'JSON',
                    url      : url.replace(/#{param}/, id),

                }).done(function (response) {
                    getAddress(response, household, members);
                });
            });
        }

        function getAddress (response, household, members) {

            var lat = 0;
            var lng = 0;

            if (response.householdInfo.address !== null) {
                lat = response.householdInfo.address.latitude;
                lng = response.householdInfo.address.longitude;
            }

            ['FEMALE', 'MALE'].forEach(function (gender) {

                if (household[gender].length > 0) {

                    members.push({
                        name          : household.name,
                        preferredName : household[gender],
                        gender        : gender,
                        lat           : lat,
                        lng           : lng,
                        inRegion      : true,
                    });
                }
            });
        }

        function showMembers (members) {

            // Sort and show members
            members = _.sortBy(members, 'name');

            members.forEach(function (member) {

                // Display member name
                member.$html = $('<div/>').text(member.preferredName);

                $members.append(member.$html);

                // Add event handler for region changing
                eventManager.on('change:region', function (region) {

                    var genderSelected = genderFilter.$el.val();
                    var latLng = new google.maps.LatLng(member.lat, member.lng);

                    member.inRegion = region.getRegion().contains(latLng);

                    // Show if user is in region and matches gender, else hide
                    var showOrHide =  member.inRegion &&
                        (member.gender === genderSelected || genderSelected === 'BOTH');

                    member.$html.toggle(showOrHide);
                });
            });

            // Filter on gender change
            eventManager.on('change:gender', function (gender) {
                filterGender(members, gender.value);
            });
        }

        function filterGender (members, selected) {

            members.forEach(function (member) {

                if (member.inRegion === false) {
                    return;
                } else if (selected === 'BOTH') {
                    member.$html.show();
                } else {
                    member.$html.toggle((member.gender === selected));
                }

            });
        }


        var $members = $('<div/>', {id : 'members-list'}).appendTo($mapMembers);
        var $memberFilters = $('<div/>', {id : 'member-filters'}).appendTo($mapMembers);

        // Show gender filter
        var genderFilter = new SelectView({
            template   : '<option value="<%= value %>" <%= selected %>><%= label %></option>',
            tagName    : 'select',
            attributes : {
                name : 'member-gender',
            },
            data : [
                {
                    label    : 'Both',
                    selected : 'selected',
                    value    : 'BOTH',
                },
                {
                    label    : 'Female',
                    selected : '',
                    value    : 'FEMALE',
                },
                {
                    label    : 'Male',
                    selected : '',
                    value    : 'MALE',
                }
            ]
        });

        $memberFilters.append(genderFilter.render().el);

        // Trigger events on gender selection
        genderFilter.$el.on('change', function (e) {
            eventManager.trigger('change:gender', e.target);
        });

        // When ward changes, reset the filter
        eventManager.on('change:ward', function () {
            genderFilter.$el.val('BOTH');
        });

        // Get things started
        getWard();
    }

})(jQuery, window);