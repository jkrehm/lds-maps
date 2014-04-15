(function ($, global) {

    /*globals _, alert, google*/

    // Events
    function EventManager() {
        this.events = [];
    }

    EventManager.prototype.on = function (e, callback) {

        this.events[e] = this.events[e] || [];

        this.events[e].push(callback);

        return this;
    };

    EventManager.prototype.trigger = function () {

        var args = Array.prototype.slice.call(arguments);
        var e = args.splice(0, 1)[0]; // First parameter will be the event name
        var events = this.events[e];

        if (events instanceof Array) {
            events.forEach(function (callback) {
                callback.apply(this, args);
            }, this);
        }

        return this;
    };


    // Map Region
    function Region(lat, lng) {

        this.currentType = 'ne';

        this.ne = 0;
        this.sw = 0;

        var mapOptions = {
            center: new google.maps.LatLng(lat, lng),
            zoom: 13,
        };

        this.map = new google.maps.Map(document.getElementById('map-canvas'), mapOptions);
    }

    Region.prototype.addCoordinate = function (e) {

        var types = {
            ne : 'sw',
            sw : 'ne'
        };

        this.set(this.currentType, new google.maps.LatLng(e.latLng.lat(), e.latLng.lng()));

        this.currentType = types[this.currentType];

        this.makeBoundaries();
    };

    Region.prototype.getRegion = function () {
        return new google.maps.LatLngBounds(this.sw, this.ne);
    };

    Region.prototype.makeBoundaries = function () {

        var self = this;

        var boundaries = new google.maps.Rectangle({
            bounds : this.getRegion(),
            draggable : true,
            editable : true,
            map : this.map,
        });

        function drag() {

            var newBoundaries = this.getBounds();

            self.set('ne', newBoundaries.getNorthEast());
            self.set('sw', newBoundaries.getSouthWest());
        }

        google.maps.event.addListener(boundaries, 'bounds_changed', _.debounce(drag, 500));

        return boundaries;
    };

    Region.prototype.set = function (property, value) {

        this[property] = value;

        // If updating the boundaries, trigger event
        if (['ne', 'sw'].indexOf(property) > -1) {
            eventManager.trigger('change:region', this);
        }
    };


    // Utility functions
    var Utilities = {

        buildURL : function (route) {

            var LDS_URL = 'https://www.lds.org/directory/services/ludrs/';

            var routes = {
                'ward-info' : 'unit/current-user-ward-stake/',
                'member-list': 'mem/member-list/#{unit_number}',
                'household': 'mem/householdProfile/#{head_of_house_individual_id}',
            };

            return LDS_URL + routes[route];
        },

        loadScripts : function () {

            $.getScript('//maps.googleapis.com/maps/api/js?sensor=false&callback=initialize');
            $.getScript('//cdnjs.cloudflare.com/ajax/libs/lodash.js/2.4.1/lodash.min.js');

            // @todo Make this work with Google?
            // $.when(
            //     $.getScript('//maps.googleapis.com/maps/api/js?sensor=false&callback=initialize'),
            //     $.getScript('//cdnjs.cloudflare.com/ajax/libs/lodash.js/2.4.1/lodash.min.js')
            // ).done(initialize);
        },

        addStyles : function () {

            var styles = [
                '#map-canvas, #households-list {',
                'bottom: 10px;',
                'position: absolute;',
                'top: 10px;',
                'z-index: 9999;',
                '}',

                '#map-canvas {',
                'left: 10px;',
                'margin-right: 5px;',
                'right: 20%;',
                '}',

                '#households-list {',
                'background-color: #fafafa;',
                'left: 80%;',
                'margin-left: 5px;',
                'overflow: auto;',
                'padding: 5px;',
                'right: 10px;',
                '}',

                '#households-list > div {',
                'margin: 5px;',
                '}',
            ];

            var s = document.createElement('style');
            s.type = 'text/css';
            s.innerHTML = styles.join(' ');
            s.appendChild(document.createTextNode(''));
            document.head.appendChild(s);
        }
    };

    // Load 3rd party scripts
    Utilities.loadScripts();
    Utilities.addStyles();


    /*** MAIN APPLICATION ***/
    var households = [];
    var totalHouseholds = 0;
    var $households;
    var eventManager = new EventManager();

    function initialize() {

        getWard();

        $('<div/>', {id : 'map-canvas'}).prependTo('body');

        $households = $('<div/>', {id : 'households-list'}).prependTo('body');

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(makeMap);
        } else {
            alert('Your browser doesn\'t support geolocation');
        }
    }

    function makeMap(location) {

        var region = new Region(location.coords.latitude, location.coords.longitude);
/*
        var mapOptions = {
            center: new google.maps.LatLng(location.coords.latitude, location.coords.longitude),
            zoom: 13,
        };

        var map = new google.maps.Map(document.getElementById('map-canvas'), mapOptions);
*/
        google.maps.event.addListener(region.map, 'click', $.proxy(region.addCoordinate, region));
    }

    function getWard() {
        $.getJSON(Utilities.buildURL('ward-info')).done(getMembers);
    }

    function getMembers(response) {

        var ward = response.wardUnitNo;
        var url = Utilities.buildURL('member-list').replace(/#{unit_number}/, ward);

        $.getJSON(url).done(getHouseholds);
    }

    function getHouseholds(response) {

        var url = Utilities.buildURL('household');

        totalHouseholds = response.length;
        response.forEach(function (hh) {

            var id = hh.headOfHouseIndividualId;
            var household = {
                name   : hh.householdName,
                MALE   : '',
                FEMALE : '',
            };

            household[hh.headOfHouse.gender] = hh.headOfHouse.preferredName;

            if (hh.spouse.preferredName.length > 0) {
                household[hh.spouse.gender] = hh.spouse.preferredName;
            }

            $.getJSON(url.replace(/#{head_of_house_individual_id}/, id)).done(function (response) {
                getAddress(response, household);
            });
        });
    }

    function getAddress(response, household) {

        if (response.householdInfo.address === null) {
            household.lat = 0;
            household.lng = 0;
        } else {
            household.lat = response.householdInfo.address.latitude;
            household.lng = response.householdInfo.address.longitude;
        }

        ['FEMALE', 'MALE'].forEach(function (gender) {

            if (household[gender].length > 0) {

                var $html = $('<div/>')
                    .text(household[gender])
                    .data(household, household)
                    .appendTo($households);

                eventManager.on('change:region', function (region) {

                    var latLng = new google.maps.LatLng(household.lat, household.lng);
                    var showOrHide = region.getRegion().contains(latLng);

                    $html.toggle(showOrHide);
                });
            }
        });

        // households.push(household);
    }

    // Expose globals
    global.households = households;
    global.initialize = initialize;

})(jQuery, window);